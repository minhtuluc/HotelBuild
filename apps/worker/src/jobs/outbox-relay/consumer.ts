import type { JobContext } from '../types.js';
import type { OutboxEnvelope } from './envelope.js';

/**
 * Cổng consumer của relay — định danh **bền** theo ADR-017 quyết định 6–7: `name` là khoá trong
 * `event_deliveries` nên đổi tên consumer là đổi hợp đồng vận chuyển (delivery cũ thành mồ côi),
 * `version` là phiên bản hợp đồng sự kiện mà consumer hiểu.
 *
 * Consumer PHẢI tự idempotent theo `(name, eventId)`: relay vận chuyển **ít nhất một lần**, có thể gọi lại
 * cùng một sự kiện khi tiến trình chết sau khi đã gây tác dụng nhưng trước khi ghi completion.
 * Tác dụng nghiệp vụ + completion phải nằm trong **một transaction của consumer**; I/O ra ngoài (mail,
 * HTTP) đi qua operation/key idempotent bền và **không** nằm trong transaction đó.
 */
export interface OutboxConsumer {
  readonly name: string;
  readonly version: number;
  /** Sự kiện nào consumer này cần nhận; relay chỉ tạo delivery cho sự kiện được nhận. */
  accepts(eventType: string): boolean;
  handle(envelope: OutboxEnvelope, context: JobContext): Promise<void>;
}

/**
 * Lỗi consumer mang **mã ổn định** để ghi `event_deliveries.last_error` mà không lộ PII/chi tiết mạng
 * (NFR-SEC-04). Consumer ném lớp này thay vì lỗi thô khi muốn vận hành biết nguyên nhân cụ thể.
 */
export class OutboxConsumerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OutboxConsumerError';
  }
}

/** Mã ghi vào `last_error` khi consumer ném lỗi không có mã ổn định (không lấy `message` của lỗi). */
export const OUTBOX_CONSUMER_UNKNOWN_ERROR = 'CONSUMER_HANDLER_FAILED';

const STABLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Mã lỗi **đã che** để lưu bền: chỉ nhận mã đúng khuôn `E_*`/`*_FAILED` của consumer, còn lại một mã chung.
 * Không bao giờ trả `error.message`/stack — chúng có thể mang payload, địa chỉ nhận hay token.
 */
export function outboxErrorCode(error: unknown): string {
  if (error instanceof OutboxConsumerError && STABLE_CODE.test(error.code)) return error.code;
  return OUTBOX_CONSUMER_UNKNOWN_ERROR;
}
