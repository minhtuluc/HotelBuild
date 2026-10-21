/**
 * Chính sách quan sát của worker — **gương** của `apps/api/src/infrastructure/tracing/sampling.ts`.
 * Ứng dụng luôn xuất đủ span; collector quyết định mẫu (giữ 100% trace lỗi/thanh toán) ở một chỗ duy nhất;
 * ở đây chỉ khai dấu "quan trọng" để collector nhận ra việc chạm tiền.
 */
export const CRITICAL_ATTRIBUTE = 'pinehill.sampling.critical';
export const CRITICAL_PAYMENT = 'PAYMENT';

/** Hàng đợi tiền tệ: chi hoàn chạm tiền ra khỏi hệ thống nên trace luôn được giữ. */
export const PAYMENT_QUEUES: readonly string[] = ['q.refund-payout'];

/** Loại sự kiện tiền tệ do worker phát — delivery của chúng phải mang dấu critical. */
export const PAYMENT_EVENT_TYPES: readonly string[] = ['RefundPaid'];

export function isPaymentQueue(queue: string): boolean {
  return PAYMENT_QUEUES.includes(queue);
}

export function isPaymentEvent(eventType: string): boolean {
  return PAYMENT_EVENT_TYPES.includes(eventType);
}
