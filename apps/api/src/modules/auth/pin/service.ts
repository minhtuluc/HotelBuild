/**
 * Nghiệp vụ PIN (HB-015): đặt PIN của mình, xác thực để lấy `pinToken` một lần, xoá PIN
 * (MANAGER cùng cơ sở / SYSADMIN). Căn cứ: QĐ-03 quyết định 4,5; BR-RBAC-05; api.md §1.2, §2.1.
 *
 * Bất biến:
 * - PIN băm Argon2id (dùng lại hạ tầng HB-013); không lưu/log PIN thô.
 * - Sai PIN 3 lần liên tiếp → khoá 15 phút (`E_AUTH_PIN_LOCKED`, kèm `retryAfterSeconds`).
 *   Số đếm/khoá nằm ở `user_pins`, đọc–ghi dưới khoá hàng để không đua.
 * - `pinToken` sinh 32 byte, DB lưu SHA-256; tiêu thụ ở `requirePinToken` (consume.ts).
 * - Mọi thay đổi (đặt/xoá/khoá PIN) ghi audit **cùng transaction** với thay đổi.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import { invalidCredentials } from '../../../common/guards/auth.guard.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { ActorContext } from '../../../common/actor/actor-context.js';
import { ScopeDeniedError, requireProperty } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import type { AuditEntry } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { hashPassword, verifyPassword } from '../../../infrastructure/crypto/passwords.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../../infrastructure/prisma/prisma.module.js';
import { createPinToken, hashPinToken, PIN_TOKEN_TTL_MS } from './token.js';
import { PIN_PURPOSE_FINANCIAL, pinRequired } from './consume.js';

/** Sai PIN 3 lần liên tiếp thì khoá thao tác cần PIN 15 phút (QĐ-03 quyết định 4; TC-AUTH-03). */
export const PIN_LOCK_THRESHOLD = 3;
export const PIN_LOCK_MS = 15 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PinGrant {
  readonly pinToken: string;
  readonly expiresAt: string;
}

export interface SetPinInput {
  readonly pin: string;
  readonly currentPassword: string;
}

export interface VerifyPinInput {
  readonly pin: string;
  readonly bookingId?: string | undefined;
}

function pinLocked(retryAfterSeconds: number): AppError {
  return new AppError(403, 'E_AUTH_PIN_LOCKED', 'PIN đang tạm khoá.', retryAfterSeconds);
}

function validationError(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
}

function notFound(): AppError {
  return new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
}

@Injectable()
export class PinService {
  constructor(
    @Inject(PRISMA) private readonly prisma: DatabaseClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  private auditEntry(
    actor: ActorContext,
    action: string,
    entityId: string | null,
    afterJson: Prisma.InputJsonValue | null,
  ): AuditEntry {
    return {
      actor,
      action,
      entityType: 'User',
      entityId,
      beforeJson: null,
      afterJson,
      reason: null,
    };
  }

  /** Đặt/thay PIN của chính mình; xác nhận `currentPassword`; thu hồi mọi grant chưa dùng. */
  async set(actor: AuthorizedActor, input: SetPinInput): Promise<void> {
    const user = await this.prisma.users.findUnique({ where: { id: actor.id } });
    if (user === null || !user.is_active) throw invalidCredentials();
    if (!(await verifyPassword(user.password_hash, input.currentPassword)))
      throw invalidCredentials();
    const pinHash = await hashPassword(input.pin);
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.user_pins.upsert({
        where: { user_id: actor.id },
        create: {
          user_id: actor.id,
          pin_hash: pinHash,
          failed_count: 0,
          locked_until: null,
          set_at: now,
        },
        update: { pin_hash: pinHash, failed_count: 0, locked_until: null, set_at: now },
      });
      await tx.pin_grants.updateMany({
        where: { user_id: actor.id, consumed_at: null },
        data: { consumed_at: now },
      });
      await this.audit.record(
        tx,
        this.auditEntry(actor, 'AUTH_PIN_SET', actor.id, { hasPin: true }),
      );
    });
  }

  /** Xác thực PIN, trả `pinToken` một lần gắn người/purpose/booking. */
  async verify(actor: AuthorizedActor, input: VerifyPinInput): Promise<PinGrant> {
    const bookingId = input.bookingId ?? null;
    if (bookingId !== null && !UUID.test(bookingId)) throw validationError();
    const now = this.clock.now();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM user_pins WHERE user_id = CAST(${actor.id} AS uuid) FOR UPDATE`;
      const row = await tx.user_pins.findUnique({ where: { user_id: actor.id } });
      if (row === null) return { kind: 'missing' as const };
      const lockedUntil = row.locked_until;
      if (lockedUntil !== null && lockedUntil.getTime() > now.getTime())
        return {
          kind: 'locked' as const,
          retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000)),
        };
      // Khoá đã hết hạn: bắt đầu lại chuỗi đếm sai.
      const failures = lockedUntil === null ? row.failed_count : 0;
      if (!(await verifyPassword(row.pin_hash, input.pin)))
        return this.registerFailure(tx, actor, now, failures);
      if (failures !== 0)
        await tx.user_pins.update({
          where: { user_id: actor.id },
          data: { failed_count: 0, locked_until: null },
        });
      if (bookingId !== null) {
        const booking = await tx.bookings.findUnique({
          where: { id: bookingId },
          select: { property_id: true },
        });
        if (booking === null) throw notFound();
        requireProperty(actor, booking.property_id);
      }
      const pinToken = createPinToken();
      const expiresAt = new Date(now.getTime() + PIN_TOKEN_TTL_MS);
      await tx.pin_grants.create({
        data: {
          id: this.ids.generate(),
          token_hash: hashPinToken(pinToken),
          user_id: actor.id,
          session_id: actor.sessionId,
          purpose: PIN_PURPOSE_FINANCIAL,
          booking_id: bookingId,
          created_at: now,
          expires_at: expiresAt,
        },
      });
      return { kind: 'grant' as const, pinToken, expiresAt };
    });
    if (result.kind === 'missing' || result.kind === 'invalid') throw pinRequired();
    if (result.kind === 'locked') throw pinLocked(result.retryAfterSeconds);
    return { pinToken: result.pinToken, expiresAt: result.expiresAt.toISOString() };
  }

  /** Ghi một lần nhập sai PIN; chạm ngưỡng thì khoá 15 phút và audit (không ghi PIN thô). */
  private async registerFailure(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    now: Date,
    failures: number,
  ): Promise<{ kind: 'invalid' } | { kind: 'locked'; retryAfterSeconds: number }> {
    const failed = failures + 1;
    const locked = failed >= PIN_LOCK_THRESHOLD ? new Date(now.getTime() + PIN_LOCK_MS) : null;
    await tx.user_pins.update({
      where: { user_id: actor.id },
      data: { failed_count: failed, locked_until: locked },
    });
    if (locked === null) return { kind: 'invalid' };
    await this.audit.record(
      tx,
      this.auditEntry(actor, 'AUTH_PIN_LOCKED', actor.id, { lockedUntil: locked.toISOString() }),
    );
    return { kind: 'locked', retryAfterSeconds: Math.ceil(PIN_LOCK_MS / 1000) };
  }

  /** Xoá PIN của người dùng trong phạm vi để họ đặt lại; thu hồi grant chưa dùng. */
  async remove(actor: AuthorizedActor, targetUserId: string): Promise<void> {
    if (!UUID.test(targetUserId)) throw validationError();
    const target = await this.prisma.users.findUnique({
      where: { id: targetUserId },
      include: { user_property_scopes: { select: { property_id: true } } },
    });
    if (target === null) throw notFound();
    if (actor.role !== 'SYSADMIN' && !actor.isOwner()) {
      const inScope = target.user_property_scopes.some((scope) =>
        actor.canActOn(scope.property_id),
      );
      if (!inScope) throw new ScopeDeniedError();
    }
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.user_pins.deleteMany({ where: { user_id: targetUserId } });
      await tx.pin_grants.updateMany({
        where: { user_id: targetUserId, consumed_at: null },
        data: { consumed_at: now },
      });
      await this.audit.record(
        tx,
        this.auditEntry(actor, 'AUTH_PIN_DELETED', targetUserId, { hasPin: false }),
      );
    });
  }
}
