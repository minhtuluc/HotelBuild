/**
 * Hợp đồng khoá HB-129 (giai đoạn A) cho **áp inbox OTA** — seam mà worker (HB-129 AC10/13) và
 * kiểm thử API cùng gọi. Đây là oracle: giai đoạn B **PHẢI** xuất đúng hình dạng dưới đây từ
 * `apps/api/src/modules/chan/inbound/index.ts`; phần còn lại của ticket chỉ kiểm hành vi quan sát
 * được (bảng CSDL + HTTP), không kiểm cấu trúc nội bộ.
 *
 * Vì sao nạp động: giai đoạn A phải **biên dịch và chạy** trước khi module tồn tại. `import` tĩnh sẽ
 * làm cả file đỏ vì lỗi phân giải module chứ không phải vì thiếu hành vi. Specifier dựng từ mảng nên
 * TypeScript không phân giải tĩnh; khi module có thật, cùng biểu thức đó nạp được (Vite/vitest xử lý
 * `.js` → `.ts` như mọi import khác của dự án).
 *
 * Hợp đồng đã pin (B không được đoán):
 * - `createOtaInboxApplier({ db, clock, ids, audit })` → `{ applyEvent(eventId) }`.
 *   Factory nhận thêm port nếu cần; bốn khoá trên là tối thiểu test cấp.
 * - `applyEvent` claim hàng inbox bằng lease/CAS, chạy **một** transaction gồm mutation nghiệp vụ,
 *   audit, outbox và `webhook_inbox.status = 'PROCESSED'`; lỗi ghi ⇒ rollback cả tập, hàng inbox
 *   không ở `PROCESSED` và lần gọi sau áp lại đúng một lần.
 * - Kết quả: `status ∈ APPLIED | SKIPPED | DUPLICATE | QUARANTINED | RETRY`, `bookingId`, `reason`.
 * - Cảnh báo vượt quota (BR-CHAN-08) ghi `audit_logs.action = 'OTA_QUOTA_OVERRUN'`,
 *   `entity_type = 'channel_allotment'`, `actor_role = 'SYSTEM'`.
 * - Huỷ OTA ghi `audit_logs.action = 'BOOKING_CANCELLED'` với `after_json.cancelReason` và
 *   `after_json.channelPolicyCode` (dấu đối soát tiền OTA, BR-CHAN-04).
 * - Cờ nghi trùng ghi `audit_logs.action = 'BOOKING_DUPLICATE_FLAGGED'` trong cùng transaction với
 *   `bookings.duplicate_suspected*`.
 * - Khoá tombstone dùng `account_key = webhook_inbox.provider_account_id` (migration 0009).
 * - Mã cách ly (`webhook_inbox.last_error`) là **mã ngắn** `[A-Z][A-Z0-9_]+`, không payload/PII.
 */
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { z } from 'zod';
import type { AuditWriter } from '../../src/infrastructure/audit/audit-writer.js';

/** Đường dẫn hiển thị trong thông điệp đỏ. */
export const OTA_INBOUND_PATH = 'apps/api/src/modules/chan/inbound/index.ts';

/** Specifier dựng động — TypeScript không phân giải tĩnh nên file biên dịch được trước khi B có mã. */
export const OTA_INBOUND_SPECIFIER = [
  '..',
  '..',
  'src',
  'modules',
  'chan',
  'inbound',
  'index.js',
].join('/');

/** Hành động audit đối soát đã pin (xem docblock đầu file). */
export const QUOTA_WARNING_ACTION = 'OTA_QUOTA_OVERRUN';
export const CANCELLED_BOOKING_ACTION = 'BOOKING_CANCELLED';
export const DUPLICATE_FLAG_ACTION = 'BOOKING_DUPLICATE_FLAGGED';

/** `webhook_inbox.last_error` là mã ngắn, không payload/PII (store HB-095, docblock `InboxOutcome`). */
export const SHORT_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,60}$/;

export const otaApplyStatusSchema = z.enum([
  'APPLIED',
  'SKIPPED',
  'DUPLICATE',
  'QUARANTINED',
  'RETRY',
]);
export type OtaApplyStatus = z.infer<typeof otaApplyStatusSchema>;

export const otaApplyResultSchema = z.object({
  status: otaApplyStatusSchema,
  bookingId: z.uuid().nullable(),
  reason: z.string().nullable(),
});
export type OtaApplyResult = z.infer<typeof otaApplyResultSchema>;

/** Port tối thiểu test cấp; factory được phép nhận thêm (worker-runtime HB-127) nhưng không bớt. */
export interface OtaInboxDeps {
  readonly db: PrismaClient;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly audit: AuditWriter;
}

export interface OtaInboxApplier {
  applyEvent(eventId: string): Promise<OtaApplyResult>;
}

export type OtaInboxFactory = (deps: OtaInboxDeps) => OtaInboxApplier;

function notImplemented(detail: string): Error {
  return new Error(
    `GIAI ĐOẠN A ĐỎ CÓ CHỦ ĐÍCH: ${OTA_INBOUND_PATH} chưa xuất createOtaInboxApplier ` +
      `(HB-129 giai đoạn B phải hiện thực seam này) — ${detail}`,
  );
}

function isFactory(value: unknown): value is { createOtaInboxApplier: OtaInboxFactory } {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'createOtaInboxApplier') === 'function';
}

function isApplier(value: unknown): value is OtaInboxApplier {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'applyEvent') === 'function';
}

let cached: OtaInboxApplier | null = null;

/** AC9 cần một "lần khởi động lại": instance mới, cùng CSDL/Redis bền. */
export function resetApplier(): void {
  cached = null;
}

export async function loadApplier(deps: OtaInboxDeps): Promise<OtaInboxApplier> {
  if (cached !== null) return cached;
  let loaded: unknown;
  try {
    loaded = await import(/* @vite-ignore */ OTA_INBOUND_SPECIFIER);
  } catch {
    throw notImplemented('không nạp được module use case');
  }
  if (!isFactory(loaded)) throw notImplemented('module không xuất createOtaInboxApplier');
  const built: unknown = loaded.createOtaInboxApplier(deps);
  if (!isApplier(built)) throw notImplemented('factory không trả về applyEvent');
  cached = built;
  return built;
}
