import type { IdGenerator } from '@pinehill/domain';

/** Mã tương quan: 1..128 ký tự thuộc `[A-Za-z0-9._-]` (api.md §1.3). */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Giữ mã client gửi nếu hợp lệ, còn lại sinh mới — dùng chung cho interceptor và filter. */
export function resolveCorrelationId(incoming: unknown, ids: IdGenerator): string {
  return typeof incoming === 'string' && CORRELATION_ID_PATTERN.test(incoming)
    ? incoming
    : ids.generate();
}
