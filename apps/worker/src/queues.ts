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
