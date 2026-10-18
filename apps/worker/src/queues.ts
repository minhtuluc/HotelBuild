export const QUEUE_NAMES = [
  'q.hold-expiry',
  'q.overbooking-scan',
  'q.channel-sync',
  'q.no-show-mark',
  'q.outbox-relay',
  'q.report-export',
  'q.export-cleanup',
  'q.notification-send',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** Ba hàng đợi chạy lặp theo nhịp; chỉ bật khi cấu hình cho phép. */
export const REPEATABLE_QUEUES = ['q.hold-expiry', 'q.outbox-relay', 'q.export-cleanup'] as const;

export const isRepeatableQueue = (name: QueueName): boolean =>
  REPEATABLE_QUEUES.some((queue) => queue === name);

/**
 * Tên job BullMQ của các nhịp lặp — handler nhận **payload**, không nhận tên job (xem `bullmq.factory`),
 * nên nhịp nào cần phân biệt thì khai chế độ trong `data` (`data.mode`) và tên ở đây chỉ để tra vết.
 */
export const HOLD_EXPIRY_JOB = 'hold-expiry';
export const HOLD_RECONCILE_JOB = 'hold-reconcile';
export const OUTBOX_RELAY_JOB = 'outbox-relay';
export const EXPORT_CLEANUP_JOB = 'export-cleanup';
