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
import { AuthSessions } from './auth-sessions.js';

/** Số lần sai liên tiếp khoá tài khoản (BR-RBAC-06). */
export const LOCK_THRESHOLD = 5;
/** Thời gian khoá tài khoản sau khi chạm ngưỡng. */
export const LOCK_MS = 15 * 60_000;

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
  private readonly sessions: AuthSessions;
  constructor(
    @Inject(CONFIG) config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(PRISMA) private readonly prisma: DatabaseClient,
    @Inject(LoginAttempts) private readonly attempts: LoginAttempts,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {
    this.sessions = new AuthSessions(config, clock, ids, prisma);
  }

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

  async login(input: LoginInput, context: RequestContext): Promise<TokenPairResponse> {
    const surface = input.clientSurface ?? 'OPS_WEB';
    await this.assertRateLimitAllowed(context);
    const initial = await this.prisma.users.findUnique({ where: { username: input.username } });
    if (initial === null) {
      await this.assertNotLocked(null, input.username, context, surface);
      await verifyAgainstDummyPassword(input.password);
      const failed = await this.attempts.recordUsernameFailure(
        input.username,
        LOCK_THRESHOLD,
        LOCK_MS,
      );
      if (failed.alreadyLocked && failed.lockedUntilMs !== null) {
        await this.auditOnly('AUTH_LOGIN_LOCKED', null, context, surface);
        throw this.lockedError(
          Math.ceil((failed.lockedUntilMs - this.clock.now().getTime()) / 1000),
        );
      }
      await this.auditOnly('AUTH_LOGIN_FAILURE', null, context, surface);
      throw invalidCredentials();
    }
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id=${initial.id}::uuid FOR UPDATE`;
        const user = await tx.users.findUnique({ where: { id: initial.id } });
        const now = this.clock.now();
        if (user === null) return { error: invalidCredentials() };
        if (user.locked_until !== null && user.locked_until.getTime() > now.getTime()) {
          await this.audit.record(
            tx,
            this.auditEntry(this.systemActor(context), 'AUTH_LOGIN_LOCKED', user.id, surface),
          );
          return {
            error: this.lockedError(
              Math.ceil((user.locked_until.getTime() - now.getTime()) / 1000),
            ),
          };
        }
        if (!(await this.passwordMatches(user, input.password))) {
          const failures = user.locked_until !== null ? 1 : user.failed_login_count + 1;
          await tx.users.update({
            where: { id: user.id },
            data: {
              failed_login_count: failures,
              locked_until: failures >= LOCK_THRESHOLD ? new Date(now.getTime() + LOCK_MS) : null,
            },
          });
          await this.audit.record(
            tx,
            this.auditEntry(this.systemActor(context), 'AUTH_LOGIN_FAILURE', user.id, surface),
          );
          return { error: invalidCredentials() };
        }
        const refreshToken = createRefreshToken();
        const familyId = this.ids.generate();
        const session = await tx.auth_sessions.create({
          data: {
            id: this.ids.generate(),
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
        return { session, user, refreshToken, now };
      },
      { timeout: 15000 },
    );
    if ('error' in result) throw result.error;
    await this.attempts.clearUsername(input.username);
    return this.sessions.pair(result.session, result.user, result.refreshToken, result.now);
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

  async refresh(refreshToken: string): Promise<TokenPairResponse> {
    return this.sessions.refresh(refreshToken);
  }

  async logout(sessionId: string): Promise<void> {
    return this.sessions.logout(sessionId);
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
