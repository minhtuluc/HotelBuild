import { isErrorCode } from '@pinehill/contracts';
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
  /**
   * Loại sự kiện consumer này nhận — **danh sách khai báo**, không phải hàm: relay dùng nó làm bộ lọc
   * trong truy vấn quét (`relay.ts`) nên sự kiện không ai nhận không chiếm lô và không làm đói sự kiện
   * khác. Consumer mới thêm loại nào thì khai ở đây, không cần sửa relay.
   */
  readonly eventTypes: readonly string[];
  handle(envelope: OutboxEnvelope, context: JobContext): Promise<void>;
}

/**
 * Lỗi consumer mang **mã từ danh mục lỗi dựng sẵn** để ghi `event_deliveries.last_error` mà không lộ
 * PII/chi tiết mạng (NFR-SEC-04). Consumer ném lớp này thay vì lỗi thô khi muốn vận hành biết nguyên nhân
 * cụ thể.
 */
export class OutboxConsumerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OutboxConsumerError';
  }
}

/** Mã ghi vào `last_error` khi consumer ném lỗi không có mã thuộc danh mục (không lấy `message` của lỗi). */
export const OUTBOX_CONSUMER_UNKNOWN_ERROR = 'CONSUMER_HANDLER_FAILED';

/**
 * Mã lỗi **đã che** để lưu bền: chỉ nhận mã có trong danh mục `@pinehill/contracts`
 * (`isErrorCode` — nguồn chân lý `docs/04-thiet-ke/api.md` §4.2), mọi thứ khác về mã chung.
 *
 * Danh mục là allowlist đóng nên mã tự do của consumer **không** đi qua được kênh này: một mã kiểu
 * `GUEST_0905123456` (tên khách + số điện thoại) bị thay bằng {@link OUTBOX_CONSUMER_UNKNOWN_ERROR} trước
 * khi vào `last_error` và log. Không bao giờ trả `error.message`/stack.
 */
export function outboxErrorCode(error: unknown): string {
  if (error instanceof OutboxConsumerError && isErrorCode(error.code)) return error.code;
  return OUTBOX_CONSUMER_UNKNOWN_ERROR;
}
