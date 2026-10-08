/**
 * Auth lõi nhân viên (HB-013): đăng nhập có khoá + hạn mức, xoay refresh trong một family, đăng xuất,
 * đổi mật khẩu và `GET /auth/me` đọc từ CSDL. Mọi thời điểm/ID lấy qua `Clock`/`IdGenerator`; mọi sự kiện
 * quan trọng ghi audit **trong cùng transaction** với thay đổi nghiệp vụ (BR-SYS-01, BR-RBAC-05/06).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { userRoleSchema } from '@pinehill/contracts';
import type { UserMe } from '@pinehill/contracts';
import { AppError } from '../../common/app-error.js';
import type { ActorContext } from '../../common/actor/actor-context.js';
import { CONFIG } from '../../config/env.js';
import type { ApiConfig } from '../../config/env.js';
import { AuditWriter } from '../../infrastructure/audit/audit-writer.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  signAccessToken,
} from '../../infrastructure/crypto/access-tokens.js';
import {
  hashPassword,
  verifyAgainstDummyPassword,
  verifyPassword,
} from '../../infrastructure/crypto/passwords.js';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  createRefreshToken,
  hashRefreshToken,
} from '../../infrastructure/crypto/refresh-tokens.js';
import { CLOCK, ID_GENERATOR } from '../../infrastructure/ports.js';
import { PRISMA } from '../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../infrastructure/prisma/prisma.module.js';
import { invalidCredentials } from '../../common/guards/auth.guard.js';
import { LoginAttempts } from './login-attempts.js';

/** Số lần sai liên tiếp khoá tài khoản (BR-RBAC-06). */
export const LOCK_THRESHOLD = 5;
/** Thời gian khoá tài khoản sau khi chạm ngưỡng. */
export const LOCK_MS = 15 * 60_000;
/** Phiên operations web hết hạn sau 15 phút nhàn rỗi (TC-AUTH-02). */
const IDLE_TIMEOUT_MS = 15 * 60_000;

const RATE_LIMITED_MESSAGE = 'Quá nhiều lần thử đăng nhập, vui lòng chờ.';
const LOCKED_MESSAGE = 'Tài khoản đang bị khoá tạm thời.';

export interface TokenPairResponse {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly refreshToken: string;
  readonly refreshExpiresInSeconds: number;
  readonly mustChangePassword: boolean;
}

export interface LoginInput {
  readonly username: string;
  readonly password: string;
  readonly clientSurface?: 'OPS_WEB' | 'OPS_ANDROID' | undefined;
}

interface RequestContext {
  readonly ip: string | null;
  readonly correlationId: string;
}

type AuditAction =
  'AUTH_LOGIN_SUCCESS' | 'AUTH_LOGIN_FAILURE' | 'AUTH_LOGIN_LOCKED' | 'AUTH_PASSWORD_CHANGED';

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(PRISMA) private readonly prisma: DatabaseClient,
    @Inject(LoginAttempts) private readonly attempts: LoginAttempts,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  private systemActor(context: RequestContext): ActorContext {
    return { id: null, role: 'SYSTEM', ip: context.ip, correlationId: context.correlationId };
  }

  private auditEntry(
    actor: ActorContext,
    action: AuditAction,
    entityId: string | null,
    surface: string | undefined,
  ) {
    return {
      actor,
      action,
      entityType: 'User',
      entityId,
      beforeJson: null,
      afterJson: surface === undefined ? null : { clientSurface: surface },
      reason: null,
    };
  }

  /** Ghi một sự kiện xác thực trong transaction riêng (thất bại không có thay đổi nghiệp vụ nào khác). */
  private async auditOnly(
    action: AuditAction,
    entityId: string | null,
    context: RequestContext,
    surface: string | undefined,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, this.auditEntry(this.systemActor(context), action, entityId, surface)),
    );
  }

  private lockedError(retryAfterSeconds: number): AppError {
    return new AppError(401, 'E_AUTH_ACCOUNT_LOCKED', LOCKED_MESSAGE, retryAfterSeconds);
  }

  private async propertyScope(userId: string): Promise<string[]> {
    const rows = await this.prisma.user_property_scopes.findMany({ where: { user_id: userId } });
    return rows.map((row) => row.property_id);
  }

  /** Ký access token cho một phiên; phần refresh do caller gắn vào phản hồi. */
  private async accessTokenFor(
    sessionId: string,
    user: { id: string; role: string },
    now: Date,
  ): Promise<string> {
    const { token } = await signAccessToken(
      {
        userId: user.id,
        role: userRoleSchema.parse(user.role),
        propertyScope: await this.propertyScope(user.id),
        sessionId,
      },
      this.config.JWT_ACCESS_SECRET,
      now,
    );
    return token;
  }

  async login(input: LoginInput, context: RequestContext): Promise<TokenPairResponse> {
    const surface = input.clientSurface ?? 'OPS_WEB';
    const now = this.clock.now();
    await this.assertRateLimitAllowed(context);
    const user = await this.prisma.users.findUnique({ where: { username: input.username } });
    await this.assertNotLocked(user, input.username, context, surface);
    if (!(await this.passwordMatches(user, input.password))) {
      await this.recordFailure(user?.id ?? null, input.username, context, surface);
      throw invalidCredentials();
    }
    if (user === null) throw invalidCredentials();
    return this.completeLogin(user, surface, context, now, input.username);
  }

  private async assertRateLimitAllowed(context: RequestContext): Promise<void> {
    const retryAfter = await this.attempts.ipRetryAfterSeconds(context.ip ?? 'unknown');
    if (retryAfter !== null) {
      throw new AppError(429, 'E_GEN_RATE_LIMITED', RATE_LIMITED_MESSAGE, retryAfter);
    }
  }

  private async assertNotLocked(
    user: { id: string; locked_until: Date | null } | null,
    username: string,
    context: RequestContext,
    surface: string,
  ): Promise<void> {
    const now = this.clock.now();
    if (
      user !== null &&
      user.locked_until !== null &&
      user.locked_until.getTime() > now.getTime()
    ) {
      await this.auditOnly('AUTH_LOGIN_LOCKED', user.id, context, surface);
      throw this.lockedError(Math.ceil((user.locked_until.getTime() - now.getTime()) / 1000));
    }
    if (user !== null) return;
    const unknownLock = await this.attempts.usernameLock(username);
    if (unknownLock === null) return;
    await this.auditOnly('AUTH_LOGIN_LOCKED', null, context, surface);
    throw this.lockedError(unknownLock);
  }

  /** Trả `false` khi tài khoản không tồn tại/bị ngưng/mật khẩu sai (luôn chạy đúng chi phí băm). */
  private async passwordMatches(
    user: { password_hash: string; is_active: boolean } | null,
    password: string,
  ): Promise<boolean> {
    if (user === null || !user.is_active) return verifyAgainstDummyPassword(password);
    return verifyPassword(user.password_hash, password);
  }

  private async completeLogin(
    user: { id: string; role: string; must_change_password: boolean },
    surface: string,
    context: RequestContext,
    now: Date,
    username: string,
  ): Promise<TokenPairResponse> {
    const refreshToken = createRefreshToken();
    const familyId = this.ids.generate();
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.auth_sessions.create({
        data: {
          principal_type: 'USER',
          user_id: user.id,
          surface,
          family_id: familyId,
          token_hash: hashRefreshToken(refreshToken),
          expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
          last_seen_at: now,
          ip: context.ip,
        },
      });
      await tx.users.update({
        where: { id: user.id },
        data: { failed_login_count: 0, locked_until: null, last_login_at: now },
      });
      await this.audit.record(
        tx,
        this.auditEntry(
          { id: user.id, role: user.role, ip: context.ip, correlationId: context.correlationId },
          'AUTH_LOGIN_SUCCESS',
          user.id,
          surface,
        ),
      );
      return created;
    });
    await this.attempts.clearUsername(username);
    return {
      tokenType: 'Bearer',
      accessToken: await this.accessTokenFor(session.id, user, now),
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
      mustChangePassword: user.must_change_password,
    };
  }

  private async recordFailure(
    userId: string | null,
    username: string,
    context: RequestContext,
    surface: string,
  ): Promise<void> {
    const now = this.clock.now();
    await this.attempts.recordIpFailure(context.ip ?? 'unknown');
    if (userId === null) {
      await this.attempts.recordUsernameFailure(username, LOCK_THRESHOLD, LOCK_MS);
      await this.auditOnly('AUTH_LOGIN_FAILURE', null, context, surface);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.users.findUnique({ where: { id: userId } });
      if (user === null) return;
      const failures = user.failed_login_count + 1;
      await tx.users.update({
        where: { id: userId },
        data: {
          failed_login_count: failures,
          locked_until:
            failures >= LOCK_THRESHOLD ? new Date(now.getTime() + LOCK_MS) : user.locked_until,
        },
      });
      await this.audit.record(
        tx,
        this.auditEntry(this.systemActor(context), 'AUTH_LOGIN_FAILURE', userId, surface),
      );
    });
  }

  async refresh(refreshToken: string): Promise<TokenPairResponse> {
    const now = this.clock.now();
    const session = await this.prisma.auth_sessions.findUnique({
      where: { token_hash: hashRefreshToken(refreshToken) },
      include: { users: true },
    });
    if (
      session === null ||
      session.revoked_at !== null ||
      session.expires_at.getTime() <= now.getTime()
    ) {
      throw invalidCredentials();
    }
    if (session.rotated_at !== null) {
      await this.revokeFamily(session.family_id, now, 'REPLAY');
      throw invalidCredentials();
    }
    if (
      session.surface === 'OPS_WEB' &&
      now.getTime() - session.last_seen_at.getTime() >= IDLE_TIMEOUT_MS
    ) {
      throw invalidCredentials();
    }
    const user = session.users;
    if (user === null || !user.is_active) throw invalidCredentials();

    const nextToken = createRefreshToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.auth_sessions.updateMany({
        where: { id: session.id, rotated_at: null, revoked_at: null },
        data: { rotated_at: now, last_seen_at: now },
      });
      if (claimed.count === 0) return null;
      return tx.auth_sessions.create({
        data: {
          principal_type: 'USER',
          user_id: session.user_id,
          surface: session.surface,
          family_id: session.family_id,
          token_hash: hashRefreshToken(nextToken),
          expires_at: session.expires_at,
          last_seen_at: now,
          ip: session.ip,
        },
      });
    });
    if (rotated === null) {
      await this.revokeFamily(session.family_id, now, 'REPLAY');
      throw invalidCredentials();
    }
    return {
      tokenType: 'Bearer',
      accessToken: await this.accessTokenFor(rotated.id, user, now),
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: nextToken,
      refreshExpiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
      mustChangePassword: user.must_change_password,
    };
  }

  private async revokeFamily(familyId: string, at: Date, reason: string): Promise<void> {
    await this.prisma.auth_sessions.updateMany({
      where: { family_id: familyId, revoked_at: null },
      data: { revoked_at: at, revoke_reason: reason },
    });
  }

  async logout(sessionId: string): Promise<void> {
    const now = this.clock.now();
    const session = await this.prisma.auth_sessions.findUnique({ where: { id: sessionId } });
    if (session === null) throw invalidCredentials();
    await this.revokeFamily(session.family_id, now, 'LOGOUT');
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (user === null) throw invalidCredentials();
    if (!(await verifyPassword(user.password_hash, currentPassword))) throw invalidCredentials();
    const now = this.clock.now();
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: userId },
        data: {
          password_hash: passwordHash,
          must_change_password: false,
          password_changed_at: now,
        },
      });
      await this.audit.record(
        tx,
        this.auditEntry(
          { id: user.id, role: user.role, ip: context.ip, correlationId: context.correlationId },
          'AUTH_PASSWORD_CHANGED',
          user.id,
          undefined,
        ),
      );
    });
  }

  async me(userId: string): Promise<UserMe> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (user === null) throw invalidCredentials();
    const [propertyScope, pin] = await Promise.all([
      this.propertyScope(userId),
      this.prisma.user_pins.findUnique({ where: { user_id: userId } }),
    ]);
    return {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: userRoleSchema.parse(user.role),
      propertyScope,
      hasPin: pin !== null,
      mustChangePassword: user.must_change_password,
    };
  }
}
