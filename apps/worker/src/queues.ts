export const QUEUE_NAMES = [
  'q.hold-expiry',
  'q.overbooking-scan',
  'q.channel-sync',
  'q.no-show-mark',
  'q.outbox-relay',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** Hai hàng đợi chạy lặp theo nhịp; chỉ bật khi cấu hình cho phép. */
export const REPEATABLE_QUEUES = ['q.hold-expiry', 'q.outbox-relay'] as const;

export const isRepeatableQueue = (name: QueueName): boolean =>
  REPEATABLE_QUEUES.some((queue) => queue === name);
