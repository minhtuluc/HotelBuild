/**
 * Kiểu công khai của seam **áp inbox OTA** (HB-129). Hình dạng khớp hợp đồng đã khoá ở
 * `apps/api/test/ota-bookings/contract.ts`; tệp này không import kiểm thử nên production và oracle
 * dùng chung đúng một chữ ký.
 *
 * `applyEvent(eventId)` nhận **`webhook_inbox.event_id`** (không phải `id`): người gọi chỉ có mã sự
 * kiện của kênh, và hàng inbox là bản ghi bền do HB-128 ghi trước khi ACK.
 */
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';

/** `status` theo hợp đồng: chỉ `APPLIED` mới là "đã áp xong nghiệp vụ". */
export type OtaApplyStatus = 'APPLIED' | 'SKIPPED' | 'DUPLICATE' | 'QUARANTINED' | 'RETRY';

export interface OtaApplyResult {
  readonly status: OtaApplyStatus;
  /** Booking vừa tạo/sửa/huỷ; `null` khi sự kiện chỉ đóng dấu tombstone hoặc không áp được. */
  readonly bookingId: string | null;
  /** Mã ngắn an toàn để đối soát (`[A-Z][A-Z0-9_]+`), không payload/PII. */
  readonly reason: string | null;
}

/** Bốn port tối thiểu; worker-runtime (HB-127) bơm thêm không bớt. */
export interface OtaInboxDeps {
  readonly db: PrismaClient;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
}

export interface OtaInboxApplier {
  applyEvent(eventId: string): Promise<OtaApplyResult>;
}
