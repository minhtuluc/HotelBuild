/**
 * Quản lý người dùng nội bộ (HB-016; UC-AUTH-02; BR-RBAC-01/02; QĐ-03 quyết định 5, 7).
 *
 * Bất biến:
 * - Đổi quyền là **một** transaction: khoá hàng → kiểm lại người gọi còn hoạt động → luật gán → `If-Match`
 *   → cập nhật vai trò/trạng thái/phạm vi → thu hồi **mọi** phiên của người đó → audit. Lỗi bất kỳ (kể cả
 *   audit) rollback tất cả; access token cũ bị `AuthGuard` từ chối ở request kế tiếp vì guard đọc
 *   `auth_sessions.revoked_at` mỗi request (không có cache, nghĩa là TTL = 0).
 * - Khoá hàng theo thứ tự `id` cho tập {người đích, người gọi, mọi OWNER đang hoạt động} (ADR-014):
 *   hai OWNER cùng vô hiệu lẫn nhau sẽ tuần tự hoá; người thua đã bị thu hồi phiên nên nhận 401.
 * - Không xoá cứng; mật khẩu tạm băm Argon2id bằng dịch vụ HB-013, không bao giờ vào audit/log/phản hồi.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type {
  CreateUserRequest,
  ListPage,
  UserAccessUpdateRequest,
  UserSummary,
  UsersQuery,
} from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { invalidCredentials } from '../../../common/guards/auth.guard.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { hashPassword } from '../../../infrastructure/crypto/passwords.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../../infrastructure/prisma/prisma.module.js';
import { countUsers, currentVersion, findSummary, pageUsers } from './queries.js';
import { assertMayAssign, assertScopeShape, forbidden, validationFailed } from './rules.js';
import { notFound } from './validation.js';

type Tx = Prisma.TransactionClient;

interface LockedUser {
  readonly id: string;
  readonly role: string;
  readonly is_active: boolean;
}

const usernameTaken = (): AppError =>
  new AppError(409, 'E_AUTH_USERNAME_TAKEN', 'Tên đăng nhập đã tồn tại.');
const versionConflict = (): AppError =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Dữ liệu đã thay đổi; hãy tải lại.');

const same = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA) readonly db: DatabaseClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  /** `GET /users`: OWNER/SYSADMIN thấy tất cả; MANAGER chỉ người có cơ sở trong phạm vi của mình. */
  async list(actor: AuthorizedActor, query: UsersQuery): Promise<ListPage<UserSummary>> {
    const manager = actor.role !== 'OWNER' && actor.role !== 'SYSADMIN';
    if (manager && query.propertyId !== undefined) requireProperty(actor, query.propertyId);
    const limit = query.limit;
    if (manager && actor.propertyScope.length === 0)
      return { data: [], meta: { limit, nextCursor: null, hasMore: false, total: 0 } };
    const filters = {
      role: query.role,
      propertyId: query.propertyId,
      q: query.q,
      scope: manager ? actor.propertyScope : null,
    };
    const now = this.clock.now();
    return this.db.$transaction(
      async (tx) => {
        const total = await countUsers(tx, filters);
        const rows = await pageUsers(tx, filters, query.cursor, limit + 1, now);
        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;
        return {
          data,
          meta: { limit, hasMore, nextCursor: hasMore ? data.at(-1)!.id : null, total },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  /** `POST /users` (QĐ-03 T9: chưa có idempotency; trùng `username` ⇒ 409 nên gửi lặp không tạo hai tài khoản). */
  async create(actor: AuthorizedActor, input: CreateUserRequest): Promise<UserSummary> {
    assertMayAssign({
      actorId: actor.id,
      actorRole: actor.role,
      targetId: null,
      targetRole: null,
      newRole: input.role,
    });
    const scope = [...new Set(input.propertyScope)].sort();
    assertScopeShape(input.role, scope);
    const passwordHash = await hashPassword(input.temporaryPassword);
    try {
      return await this.db.$transaction(async (tx) => {
        await this.requireProperties(tx, scope);
        const created = await tx.users.create({
          data: {
            username: input.username,
            password_hash: passwordHash,
            full_name: input.fullName,
            role: input.role,
            phone: input.phone ?? null,
            must_change_password: true,
          },
          select: { id: true },
        });
        if (scope.length > 0)
          await tx.user_property_scopes.createMany({
            data: scope.map((propertyId) => ({ user_id: created.id, property_id: propertyId })),
          });
        await this.audit.record(tx, {
          actor,
          action: 'USER_CREATED',
          entityType: 'User',
          entityId: created.id,
          beforeJson: null,
          afterJson: {
            username: input.username,
            role: input.role,
            isActive: true,
            propertyScope: scope,
          },
          reason: null,
        });
        return this.summary(tx, created.id);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw usernameTaken();
      throw error;
    }
  }

  /** Tiền kiểm không khoá (chạy trước claim idempotency): đích tồn tại và luật gán. Khoá thật nằm ở `update`. */
  async authorize(
    db: DatabaseClient,
    actor: AuthorizedActor,
    targetId: string,
    input: UserAccessUpdateRequest,
  ): Promise<void> {
    const target = await db.users.findUnique({ where: { id: targetId }, select: { role: true } });
    if (target === null) throw notFound();
    assertMayAssign({
      actorId: actor.id,
      actorRole: actor.role,
      targetId,
      targetRole: target.role,
      newRole: input.role,
    });
  }

  /** `PUT /users/{id}/access` chạy trong transaction của idempotency (`tx`). */
  async update(
    tx: Tx,
    actor: AuthorizedActor,
    targetId: string,
    input: UserAccessUpdateRequest,
    expected: bigint,
  ): Promise<UserSummary> {
    const locked = await this.lockRows(tx, targetId, actor.id);
    const actorRow = locked.find((row) => row.id === actor.id);
    if (actorRow === undefined || !actorRow.is_active || !(await this.sessionAlive(tx, actor)))
      throw invalidCredentials();
    const target = locked.find((row) => row.id === targetId);
    if (target === undefined) throw notFound();
    assertMayAssign({
      actorId: actor.id,
      actorRole: actorRow.role,
      targetId,
      targetRole: target.role,
      newRole: input.role,
    });
    if ((await currentVersion(tx, targetId)) !== expected) throw versionConflict();
    this.assertKeepsAnOwner(locked, target, input);
    assertScopeShape(input.role, input.propertyScope);
    await this.requireProperties(tx, input.propertyScope);

    const before = await this.access(tx, targetId);
    const after = {
      role: input.role,
      isActive: input.isActive,
      propertyScope: input.propertyScope,
    };
    const changed =
      before.role !== after.role ||
      before.isActive !== after.isActive ||
      !same(before.propertyScope, after.propertyScope);
    await tx.users.update({
      where: { id: targetId },
      data: { role: input.role, is_active: input.isActive },
    });
    await tx.user_property_scopes.deleteMany({ where: { user_id: targetId } });
    if (input.propertyScope.length > 0)
      await tx.user_property_scopes.createMany({
        data: input.propertyScope.map((propertyId) => ({
          user_id: targetId,
          property_id: propertyId,
        })),
      });
    const revoked = changed
      ? (
          await tx.auth_sessions.updateMany({
            where: { user_id: targetId, revoked_at: null },
            data: { revoked_at: this.clock.now(), revoke_reason: 'ACCESS_CHANGED' },
          })
        ).count
      : 0;
    await this.audit.record(tx, {
      actor,
      action: 'USER_ACCESS_UPDATED',
      entityType: 'User',
      entityId: targetId,
      beforeJson: before,
      afterJson: { ...after, revokedSessions: revoked },
      reason: null,
    });
    return this.summary(tx, targetId);
  }

  /** Khoá {đích, người gọi, mọi OWNER đang hoạt động} theo `id` tăng dần; đọc lại trạng thái sau khi khoá. */
  private lockRows(tx: Tx, targetId: string, actorId: string): Promise<LockedUser[]> {
    return tx.$queryRaw<LockedUser[]>`
      SELECT id::text AS id, role, is_active FROM users
       WHERE id = ${targetId}::uuid OR id = ${actorId}::uuid OR (role = 'OWNER' AND is_active)
       ORDER BY id FOR UPDATE`;
  }

  private async sessionAlive(tx: Tx, actor: AuthorizedActor): Promise<boolean> {
    const session = await tx.auth_sessions.findUnique({
      where: { id: actor.sessionId },
      select: { revoked_at: true },
    });
    return session !== null && session.revoked_at === null;
  }

  /** Không để hệ thống không còn OWNER hoạt động (kể cả hai yêu cầu song song: các hàng OWNER đã bị khoá). */
  private assertKeepsAnOwner(
    locked: readonly LockedUser[],
    target: LockedUser,
    input: UserAccessUpdateRequest,
  ): void {
    const leaves =
      target.role === 'OWNER' && target.is_active && (input.role !== 'OWNER' || !input.isActive);
    if (!leaves) return;
    const others = locked.filter(
      (row) => row.role === 'OWNER' && row.is_active && row.id !== target.id,
    );
    if (others.length === 0) throw forbidden();
  }

  private async requireProperties(tx: Tx, scope: readonly string[]): Promise<void> {
    if (scope.length === 0) return;
    const found = await tx.properties.count({ where: { id: { in: [...scope] } } });
    if (found !== scope.length) throw validationFailed();
  }

  private async access(tx: Tx, id: string) {
    const summary = await this.summary(tx, id);
    return { role: summary.role, isActive: summary.isActive, propertyScope: summary.propertyScope };
  }

  private async summary(tx: Tx, id: string): Promise<UserSummary> {
    const summary = await findSummary(tx, id, this.clock.now());
    if (summary === null) throw notFound();
    return summary;
  }
}
