import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AppError } from '../../../common/app-error.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { forbidden, missing } from './validation.js';

/**
 * Hành động nhật ký của HB-129 AC12 — hợp đồng giai đoạn A khoá đúng chuỗi này.
 */
export const DUPLICATE_FLAG_ACTION = 'BOOKING_DUPLICATE_FLAGGED';

export interface DuplicateFlagCommand {
  readonly channelId: string;
  readonly bookingId: string;
  readonly flagged: boolean;
  readonly reason: string;
  /** Version hiện hành client gửi qua `If-Match`. */
  readonly expected: bigint;
}

/**
 * Thân phản hồi: kết quả soát + version **booking** sau khi ghi (nguồn của ETag). Cố ý không trả
 * `duplicate_suspected_version`: đó là bộ đếm nội bộ của bảng, không phải khoá lạc quan của API.
 */
export interface DuplicateFlagBody {
  readonly bookingId: string;
  readonly flagged: boolean;
  readonly reason: string;
  readonly flaggedAt: string | null;
  readonly version: number;
}

interface FlagRow {
  readonly property_id: string;
  readonly version: bigint;
  readonly duplicate_suspected: boolean;
  readonly duplicate_suspected_version: bigint;
}

const versionConflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Phiên bản booking đã thay đổi.');

@Injectable()
export class OtaReviewService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {}

  /**
   * Một transaction cho cờ + actor + lý do + version + nhật ký (AC12). Không đụng
   * `payments`/`price_snapshots`/`booking_charges`/`room_assignments`: gắn cờ là quyết định soát tay,
   * không phải huỷ hay gộp booking.
   */
  async review(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    command: DuplicateFlagCommand,
  ): Promise<DuplicateFlagBody> {
    if (!['MANAGER', 'OWNER'].includes(actor.role)) throw forbidden();
    await tx.$executeRaw`SET LOCAL lock_timeout='2s'`;
    const rows = await tx.$queryRaw<FlagRow[]>`
      SELECT property_id, version, duplicate_suspected, duplicate_suspected_version
        FROM bookings
       WHERE id = ${command.bookingId}::uuid
         AND channel_id = ${command.channelId}::uuid
         FOR UPDATE`;
    const booking = rows[0];
    // Kênh sai hoặc booking không tồn tại đều là "không có tài nguyên trong phạm vi URL" (AC12).
    if (booking === undefined) throw missing();
    requireProperty(actor, booking.property_id);
    if (booking.version !== command.expected) throw versionConflict();
    const now = this.clock.now();
    const reason = command.flagged ? command.reason : null;
    const updated = await tx.$queryRaw<{ version: bigint; duplicate_suspected_version: bigint }[]>`
      UPDATE bookings
         SET duplicate_suspected = ${command.flagged},
             duplicate_suspected_by = ${command.flagged ? actor.id : null}::uuid,
             duplicate_suspected_reason = ${reason},
             duplicate_suspected_at = ${command.flagged ? now : null},
             updated_at = ${now}
       WHERE id = ${command.bookingId}::uuid
      RETURNING version, duplicate_suspected_version`;
    const after = updated[0];
    if (after === undefined) throw missing();
    await this.audit.record(tx, {
      actor,
      action: DUPLICATE_FLAG_ACTION,
      entityType: 'Booking',
      entityId: command.bookingId,
      beforeJson: {
        duplicateSuspected: booking.duplicate_suspected,
        duplicateSuspectedVersion: booking.duplicate_suspected_version.toString(),
        version: booking.version.toString(),
      },
      afterJson: {
        flagged: command.flagged,
        duplicateSuspectedVersion: after.duplicate_suspected_version.toString(),
        version: after.version.toString(),
      },
      // Lý do vào nhật ký kể cả khi gỡ cờ: người soát phải giải trình được cả hai chiều.
      reason: command.reason,
    });
    return {
      bookingId: command.bookingId,
      flagged: command.flagged,
      reason: command.reason,
      flaggedAt: command.flagged ? now.toISOString() : null,
      version: Number(after.version),
    };
  }
}
