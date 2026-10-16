import type { OutboxConsumer } from './consumer.js';

/**
 * Sổ đăng ký consumer của relay outbox — **điểm nối duy nhất** giữa relay và nghiệp vụ tiêu thụ sự kiện.
 * Tên consumer ở đây là khoá bền trong `event_deliveries` (`(consumer, event_id)`), nên đổi tên một mục
 * trong danh sách là đổi hợp đồng vận chuyển: delivery cũ thành mồ côi và cần vận hành xử lý.
 *
 * Hiện **chưa có** consumer nào trong `apps/worker`: HB-131 đăng ký consumer đồng bộ kênh và consumer thông
 * báo điều chuyển (HB-130 AC11/12) đăng ký tại đây khi tới lượt. Vì danh sách rỗng, `relayOnce` thoát sớm
 * và **không** đánh dấu vận chuyển — sự kiện vẫn `PENDING` cho tới khi có consumer thật, không bị dọn oan.
 */
export const OUTBOX_CONSUMERS: readonly OutboxConsumer[] = [];
