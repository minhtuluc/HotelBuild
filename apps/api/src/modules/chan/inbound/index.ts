/**
 * Seam **áp inbox OTA** (HB-129) — điểm vào duy nhất mà worker (qua `worker-runtime/ota-inbox.ts`) và
 * kiểm thử hợp đồng cùng gọi.
 *
 * `createOtaInboxApplier({ db, clock, ids, audit })` trả `{ applyEvent(eventId) }`; mọi tác động nghiệp
 * vụ, audit, outbox và việc đóng `webhook_inbox` nằm trong **một** transaction (AC6). Không có
 * entrypoint HTTP nào bị import từ đây để worker dùng lại được (AC13).
 */
import { OtaInboxApplierImpl } from './applier.js';
import type { OtaInboxApplier, OtaInboxDeps } from './types.js';

export function createOtaInboxApplier(deps: OtaInboxDeps): OtaInboxApplier {
  return new OtaInboxApplierImpl(deps);
}

export { OTA_CODE } from './codes.js';
export type { OtaApplyResult, OtaApplyStatus, OtaInboxApplier, OtaInboxDeps } from './types.js';
