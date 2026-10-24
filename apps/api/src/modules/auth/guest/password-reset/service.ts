/**
 * Đặt lại mật khẩu khách qua email (HB-028; QĐ-03 quyết định 10, T7; NFR-SEC-03/05).
 *
 * - `request`: luôn kết thúc như nhau ở phía gọi (202) dù SĐT có tài khoản/email hay không. Chỉ khi khách
 *   **có tài khoản mật khẩu và email** mới cấp token (32 byte ngẫu nhiên, CSDL chỉ giữ SHA-256) trong một
 *   transaction cùng audit; thư gửi **sau khi commit**. Lỗi gửi thư không đổi phản hồi: log + audit riêng.
 * - `confirm`: khoá dòng token (`FOR UPDATE`) → kiểm hạn/đã dùng theo `Clock` → đổi băm Argon2id → thu hồi
 *   **mọi** phiên của khách → đánh dấu token đã dùng → audit, tất cả trong một transaction (một bước lỗi
 *   thì không bước nào có hiệu lực).
 * Lệnh công khai nên không dùng `@Idempotent` (thư phải gửi sau commit, ngoài transaction idempotency);
 * chống lặp dựa vào token một lần + hạn mức 3 yêu cầu/giờ.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AppError } from '../../../../common/app-error.js';
import type { ActorContext } from '../../../../common/actor/actor-context.js';
import { CONFIG } from '../../../../config/env.js';
import type { ApiConfig } from '../../../../config/env.js';
import { AuditWriter } from '../../../../infrastructure/audit/audit-writer.js';
import { hashPassword } from '../../../../infrastructure/crypto/passwords.js';
import { MAILER, MailDeliveryError } from '../../../../infrastructure/mail/mailer.js';
import type { Mailer } from '../../../../infrastructure/mail/mailer.js';
import { CLOCK } from '../../../../infrastructure/ports.js';
import { PRISMA } from '../../../../infrastructure/prisma/prisma.module.js';
import type { DatabaseClient } from '../../../../infrastructure/prisma/prisma.module.js';
import { normalizePhone } from '../../../crm/guests/phone.js';
import { PasswordResetAttempts } from './attempts.js';
import { resetLink, resetMail } from './mail-text.js';
import { RESET_TOKEN_TTL_MS, hashResetToken, newResetToken, plausibleResetToken } from './token.js';

export interface RequestContext {
  readonly ip: string | null;
  readonly correlationId: string;
}

interface Issued {
  readonly guestId: string;
  readonly email: string;
  readonly token: string;
}

interface ResetRow {
  readonly id: string;
  readonly guest_id: string;
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
}

const RATE_LIMITED_MESSAGE = 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần, vui lòng thử lại sau.';

export const invalidResetToken = (): AppError =>
  new AppError(
    400,
    'E_AUTH_RESET_TOKEN_INVALID',
    'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã được dùng.',
  );

/** Cùng khoá advisory với `AuthSessions.lockFamily`: refresh/đăng xuất và thu hồi nối tiếp nhau theo family. */
async function lockFamily(tx: Prisma.TransactionClient, familyId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`auth:family:${familyId}`}::text, 0))`;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PRISMA) private readonly prisma: DatabaseClient,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(PasswordResetAttempts) private readonly attempts: PasswordResetAttempts,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private systemActor(context: RequestContext): ActorContext {
    return { id: null, role: 'SYSTEM', ip: context.ip, correlationId: context.correlationId };
  }

  async request(rawPhone: string, context: RequestContext): Promise<void> {
    const phone = normalizePhone(rawPhone);
    const retryAfter = await this.attempts.retryAfterSeconds(phone);
    if (retryAfter !== null)
      throw new AppError(429, 'E_GEN_RATE_LIMITED', RATE_LIMITED_MESSAGE, retryAfter);
    const issued = await this.prisma.$transaction((tx) => this.issue(tx, phone, context));
    if (issued !== null) await this.deliver(issued, context);
  }

  /** `null` khi SĐT không có tài khoản mật khẩu + email: không ghi gì, không gửi thư. */
  private async issue(
    tx: Prisma.TransactionClient,
    phone: string,
    context: RequestContext,
  ): Promise<Issued | null> {
    const guest = await tx.guests.findFirst({
      where: { phone, anonymized_at: null },
      select: { id: true, email: true, guest_credentials: { select: { guest_id: true } } },
    });
    const email = guest?.email?.trim();
    if (guest === null || email === undefined || email === '' || guest.guest_credentials === null)
      return null;
    const now = this.clock.now();
    // Token mới thay thế mọi token còn hiệu lực của khách: chỉ liên kết mới nhất dùng được.
    await tx.guest_password_resets.updateMany({
      where: { guest_id: guest.id, consumed_at: null },
      data: { consumed_at: now },
    });
    const token = newResetToken();
    await tx.guest_password_resets.create({
      data: {
        guest_id: guest.id,
        token_hash: hashResetToken(token),
        created_at: now,
        expires_at: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      },
    });
    await this.audit.record(tx, {
      actor: this.systemActor(context),
      action: 'GUEST_PASSWORD_RESET_REQUESTED',
      entityType: 'Guest',
      entityId: guest.id,
      beforeJson: null,
      afterJson: null,
      reason: null,
    });
    return { guestId: guest.id, email, token };
  }

  /** Sau commit: lỗi gửi chỉ để lại dấu vết (log + audit), không đổi phản hồi và không lộ token/địa chỉ. */
  private async deliver(issued: Issued, context: RequestContext): Promise<void> {
    try {
      const base = this.config.GUEST_WEB_BASE_URL;
      if (base === undefined) throw new MailDeliveryError('GUEST_WEB_BASE_URL_MISSING');
      await this.mailer.send(resetMail(issued.email, resetLink(base, issued.token)));
    } catch (error) {
      const errorCode = error instanceof MailDeliveryError ? error.code : 'MAIL_ERROR';
      this.logger.error(
        { event: 'PASSWORD_RESET_EMAIL_FAILED', errorCode, correlationId: context.correlationId },
        'Password reset email not sent',
      );
      await this.auditDeliveryFailure(issued.guestId, errorCode, context);
    }
  }

  private async auditDeliveryFailure(
    guestId: string,
    errorCode: string,
    context: RequestContext,
  ): Promise<void> {
    try {
      await this.prisma.$transaction((tx) =>
        this.audit.record(tx, {
          actor: this.systemActor(context),
          action: 'PASSWORD_RESET_EMAIL_FAILED',
          entityType: 'Guest',
          entityId: guestId,
          beforeJson: null,
          afterJson: { errorCode },
          reason: null,
        }),
      );
    } catch {
      this.logger.error(
        { event: 'PASSWORD_RESET_AUDIT_FAILED', correlationId: context.correlationId },
        'Password reset failure audit not stored',
      );
    }
  }

  async confirm(token: string, newPassword: string, context: RequestContext): Promise<void> {
    if (!plausibleResetToken(token)) throw invalidResetToken();
    const tokenHash = hashResetToken(token);
    await this.prisma.$transaction(
      async (tx) => {
        const now = this.clock.now();
        // Khoá dòng token: hai lệnh cùng token xếp hàng, lệnh sau thấy `consumed_at` và bị từ chối.
        const rows = await tx.$queryRaw<ResetRow[]>`
          SELECT id, guest_id, expires_at, consumed_at FROM guest_password_resets
          WHERE token_hash = ${tokenHash} FOR UPDATE`;
        const reset = rows[0];
        if (
          reset === undefined ||
          reset.consumed_at !== null ||
          reset.expires_at.getTime() <= now.getTime()
        )
          throw invalidResetToken();
        const credential = await tx.guest_credentials.updateMany({
          where: { guest_id: reset.guest_id },
          data: {
            password_hash: await hashPassword(newPassword),
            password_changed_at: now,
            failed_login_count: 0,
            locked_until: null,
          },
        });
        if (credential.count === 0) throw invalidResetToken();
        const revoked = await this.revokeSessions(tx, reset.guest_id, now);
        await tx.guest_password_resets.updateMany({
          where: { guest_id: reset.guest_id, consumed_at: null },
          data: { consumed_at: now },
        });
        await this.audit.record(tx, {
          actor: this.systemActor(context),
          action: 'GUEST_PASSWORD_RESET_CONFIRMED',
          entityType: 'Guest',
          entityId: reset.guest_id,
          beforeJson: null,
          afterJson: { revokedSessions: revoked },
          reason: null,
        });
      },
      { timeout: 15000 },
    );
  }

  /** Thu hồi mọi phiên chưa thu hồi của khách (kể cả đã xoay), khoá từng family theo thứ tự cố định. */
  private async revokeSessions(
    tx: Prisma.TransactionClient,
    guestId: string,
    now: Date,
  ): Promise<number> {
    const families = await tx.auth_sessions.findMany({
      where: { guest_id: guestId, revoked_at: null },
      select: { family_id: true },
      distinct: ['family_id'],
      orderBy: { family_id: 'asc' },
    });
    for (const family of families) await lockFamily(tx, family.family_id);
    const result = await tx.auth_sessions.updateMany({
      where: { guest_id: guestId, revoked_at: null },
      data: { revoked_at: now, revoke_reason: 'PASSWORD_RESET' },
    });
    return result.count;
  }
}
