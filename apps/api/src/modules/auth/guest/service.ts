/**
 * Auth khách (HB-017; UC-AUTH-03, BR-CRM-01, QĐ-03 quyết định 2/3/10, T4/T11): đăng ký, đăng nhập, refresh
 * bằng SĐT + mật khẩu. Dùng lại của HB-013: băm Argon2id, token refresh, ký access token, hạn mức IP và bộ
 * đếm định danh không tồn tại (`LoginAttempts`), ngưỡng/thời gian khoá (`LOCK_THRESHOLD`/`LOCK_MS`),
 * `Clock`/`IdGenerator` và audit trong cùng transaction với thay đổi nghiệp vụ.
 *
 * - **Không chiếm hồ sơ (T11):** SĐT đã có `guests` (có hay chưa có tài khoản) ⇒ `409 E_AUTH_PHONE_REGISTERED`,
 *   hồ sơ cũ không bị đọc ghi. Hai lệnh đăng ký đồng thời cùng SĐT được tuần tự hoá bằng advisory lock theo SĐT.
 * - **Không dò được tài khoản (T4):** SĐT không có tài khoản ⇒ cùng thông điệp, cùng chi phí băm và cùng ngưỡng
 *   khoá (bộ đếm Redis theo SĐT canonical) như SĐT có tài khoản.
 * - Audit không chứa SĐT/email/mật khẩu/token; chủ thể ghi nhật ký là `SYSTEM` (khách không phải `users`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import type { ActorContext } from '../../../common/actor/actor-context.js';
import { invalidCredentials } from '../../../common/guards/auth.guard.js';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import {
  hashPassword,
  verifyAgainstDummyPassword,
  verifyPassword,
} from '../../../infrastructure/crypto/passwords.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../../infrastructure/prisma/prisma.module.js';
import { LOCK_MS, LOCK_THRESHOLD } from '../auth.service.js';
import type { TokenPairResponse } from '../auth.service.js';
import { LoginAttempts } from '../login-attempts.js';
import { GuestSessions } from './sessions.js';
import type { LoginCommand, RegisterCommand, RequestContext } from './validation.js';

const RATE_LIMITED_MESSAGE = 'Quá nhiều lần thử đăng nhập, vui lòng chờ.';
const LOCKED_MESSAGE = 'Tài khoản đang bị khoá tạm thời.';

type GuestAuditAction =
  'GUEST_REGISTERED' | 'GUEST_LOGIN_SUCCESS' | 'GUEST_LOGIN_FAILURE' | 'GUEST_LOGIN_LOCKED';

function phoneRegistered(): AppError {
  return new AppError(
    409,
    'E_AUTH_PHONE_REGISTERED',
    'Số điện thoại đã có hồ sơ tại khách sạn. Vui lòng liên hệ lễ tân.',
  );
}

/** Vi phạm `uq_guests_phone` do đua tranh ngoài advisory lock (ví dụ hồ sơ tạo bởi tuyến khác). */
function isPhoneConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const target: unknown = error.meta?.['target'];
  return Array.isArray(target) ? target.includes('phone') : String(target).includes('phone');
}

@Injectable()
export class GuestAuthService {
  private readonly sessions: GuestSessions;
  constructor(
    @Inject(CONFIG) config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) ids: IdGenerator,
    @Inject(PRISMA) private readonly prisma: DatabaseClient,
    @Inject(LoginAttempts) private readonly attempts: LoginAttempts,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {
    this.sessions = new GuestSessions(config, clock, ids, prisma);
  }

  private systemActor(context: RequestContext): ActorContext {
    return { id: null, role: 'SYSTEM', ip: context.ip, correlationId: context.correlationId };
  }

  private entry(
    context: RequestContext,
    action: GuestAuditAction,
    entityId: string | null,
    afterJson: Prisma.InputJsonValue,
  ) {
    return {
      actor: this.systemActor(context),
      action,
      entityType: 'Guest',
      entityId,
      beforeJson: null,
      afterJson,
      reason: null,
    };
  }

  /** Ghi một sự kiện xác thực trong transaction riêng (thất bại không kèm thay đổi nghiệp vụ nào khác). */
  private async auditOnly(
    context: RequestContext,
    action: GuestAuditAction,
    entityId: string | null,
    surface: string,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, this.entry(context, action, entityId, { clientSurface: surface })),
    );
  }

  private lockedError(retryAfterSeconds: number): AppError {
    return new AppError(401, 'E_AUTH_ACCOUNT_LOCKED', LOCKED_MESSAGE, retryAfterSeconds);
  }

  private async assertRateLimitAllowed(context: RequestContext): Promise<void> {
    const retryAfter = await this.attempts.ipRetryAfterSeconds(context.ip ?? 'unknown');
    if (retryAfter !== null)
      throw new AppError(429, 'E_GEN_RATE_LIMITED', RATE_LIMITED_MESSAGE, retryAfter);
  }

  async register(command: RegisterCommand, context: RequestContext): Promise<TokenPairResponse> {
    await this.assertRateLimitAllowed(context);
    const passwordHash = await hashPassword(command.password);
    let result;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          // Tuần tự hoá mọi lệnh đăng ký cùng SĐT canonical: người đến sau thấy hồ sơ của người đến trước.
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`guest-register:${command.phone}`}::text, 0))`;
          const existing = await tx.guests.findFirst({
            where: { phone: command.phone },
            select: { id: true },
          });
          if (existing !== null) throw phoneRegistered();
          const now = this.clock.now();
          const guest = await tx.guests.create({
            data: {
              full_name: command.fullName,
              phone: command.phone,
              email: command.email,
              consent_marketing: command.consentMarketing,
              consent_at: now,
              consent_version: command.consentVersion,
            },
            select: { id: true },
          });
          await tx.guest_credentials.create({
            data: { guest_id: guest.id, password_hash: passwordHash, password_changed_at: now },
          });
          const opened = await this.sessions.open(tx, guest.id, command.surface, context.ip, now);
          await this.audit.record(
            tx,
            this.entry(context, 'GUEST_REGISTERED', guest.id, {
              consentMarketing: command.consentMarketing,
              consentVersion: command.consentVersion,
              clientSurface: command.surface,
            }),
          );
          return { guestId: guest.id, ...opened, now };
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (isPhoneConflict(error)) throw phoneRegistered();
      throw error;
    }
    return this.sessions.pair(result.session, result.guestId, result.refreshToken, result.now);
  }

  async login(command: LoginCommand, context: RequestContext): Promise<TokenPairResponse> {
    await this.assertRateLimitAllowed(context);
    const initial = await this.prisma.guest_credentials.findFirst({
      where: { guests: { phone: command.phone, anonymized_at: null } },
      select: { guest_id: true },
    });
    if (initial === null) return this.failUnknown(command, context);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT guest_id FROM guest_credentials WHERE guest_id=${initial.guest_id}::uuid FOR UPDATE`;
        const credential = await tx.guest_credentials.findUnique({
          where: { guest_id: initial.guest_id },
        });
        const now = this.clock.now();
        if (credential === null) return { error: invalidCredentials() };
        if (credential.locked_until !== null && credential.locked_until.getTime() > now.getTime()) {
          await this.audit.record(
            tx,
            this.entry(context, 'GUEST_LOGIN_LOCKED', credential.guest_id, {
              clientSurface: command.surface,
            }),
          );
          return {
            error: this.lockedError(
              Math.ceil((credential.locked_until.getTime() - now.getTime()) / 1000),
            ),
          };
        }
        if (!(await verifyPassword(credential.password_hash, command.password))) {
          const failures = credential.locked_until !== null ? 1 : credential.failed_login_count + 1;
          await tx.guest_credentials.update({
            where: { guest_id: credential.guest_id },
            data: {
              failed_login_count: failures,
              locked_until: failures >= LOCK_THRESHOLD ? new Date(now.getTime() + LOCK_MS) : null,
              updated_at: now,
            },
          });
          await this.audit.record(
            tx,
            this.entry(context, 'GUEST_LOGIN_FAILURE', credential.guest_id, {
              clientSurface: command.surface,
            }),
          );
          return { error: invalidCredentials() };
        }
        const opened = await this.sessions.open(
          tx,
          credential.guest_id,
          command.surface,
          context.ip,
          now,
        );
        await tx.guest_credentials.update({
          where: { guest_id: credential.guest_id },
          data: { failed_login_count: 0, locked_until: null, updated_at: now },
        });
        await this.audit.record(
          tx,
          this.entry(context, 'GUEST_LOGIN_SUCCESS', credential.guest_id, {
            clientSurface: command.surface,
          }),
        );
        return { guestId: credential.guest_id, ...opened, now };
      },
      { timeout: 15000 },
    );
    if ('error' in result) throw result.error;
    await this.attempts.clearUsername(command.phone);
    return this.sessions.pair(result.session, result.guestId, result.refreshToken, result.now);
  }

  /** SĐT chưa có tài khoản: cùng chi phí băm, cùng thông điệp và cùng ngưỡng khoá như tài khoản thật (T4). */
  private async failUnknown(command: LoginCommand, context: RequestContext): Promise<never> {
    const locked = await this.attempts.usernameLock(command.phone);
    if (locked !== null) {
      await this.auditOnly(context, 'GUEST_LOGIN_LOCKED', null, command.surface);
      throw this.lockedError(locked);
    }
    await verifyAgainstDummyPassword(command.password);
    const failed = await this.attempts.recordUsernameFailure(
      command.phone,
      LOCK_THRESHOLD,
      LOCK_MS,
    );
    if (failed.alreadyLocked && failed.lockedUntilMs !== null) {
      await this.auditOnly(context, 'GUEST_LOGIN_LOCKED', null, command.surface);
      throw this.lockedError(Math.ceil((failed.lockedUntilMs - this.clock.now().getTime()) / 1000));
    }
    await this.auditOnly(context, 'GUEST_LOGIN_FAILURE', null, command.surface);
    throw invalidCredentials();
  }

  refresh(refreshToken: string): Promise<TokenPairResponse> {
    return this.sessions.refresh(refreshToken);
  }
}
