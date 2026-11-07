/** Tên duy nhất của hàng đợi quét quá tải (HB-127) — mọi chỗ khác dùng hằng này, không chép chuỗi. */
export const OVERBOOKING_SCAN_QUEUE = 'q.overbooking-scan' as const;

export const QUEUE_NAMES = [
  'q.hold-expiry',
  OVERBOOKING_SCAN_QUEUE,
  'q.channel-sync',
  'q.ota-inbox',
  'q.no-show-mark',
  'q.outbox-relay',
  'q.report-export',
  'q.export-cleanup',
  'q.notification-send',
  'q.refund-payout',
  'q.alerts-scan',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** Các hàng đợi chạy lặp theo nhịp; chỉ bật khi cấu hình cho phép. */
export const REPEATABLE_QUEUES = [
  'q.hold-expiry',
  OVERBOOKING_SCAN_QUEUE,
  'q.ota-inbox',
  'q.no-show-mark',
  'q.outbox-relay',
  'q.channel-sync',
  'q.export-cleanup',
  'q.refund-payout',
  'q.alerts-scan',
] as const;

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
export const REFUND_PAYOUT_JOB = 'refund-payout';
export const NO_SHOW_MARK_JOB = 'no-show-mark';
/** HB-129 — quét `q.ota-inbox` đến hạn; payload `{}` nghĩa là quét, không phải một `eventId`. */
export const OTA_INBOX_JOB = 'ota-inbox';
/** HB-182 — quét cảnh báo vận hành (NFR-OBS-04); không có `data.mode`, một nhịp duy nhất. */
export const ALERTS_SCAN_JOB = 'alerts-scan';
/**
 * HB-131 — quét đồng bộ kênh. Nhịp **không** lấy từ `WorkerConfig` mà từ `SystemSetting`
 * (`job.channelSync.intervalSeconds`, mặc định 300 giây) nên `repeatSchedules` trả mặc định và
 * `createWorkerApp` đọc cấu hình hiện hành lúc khởi động (BR-SYS-02).
 */
export const CHANNEL_SYNC_JOB = 'channel-sync';
/**
 * HB-127 — quét quá tải. Nhịp **không** nằm trong `WorkerConfig`: nó đọc từ SystemSetting
 * `job.overbooking.scanIntervalMinutes` (mặc định 60 phút) và đổi được không triển khai lại, nên lịch do
 * `overbooking/schedule.ts` quản dưới một identity cố định thay vì `repeatSchedules`.
 */
export const OVERBOOKING_SCAN_JOB = 'overbooking-scan';
export const OVERBOOKING_SCAN_SCHEDULER_ID = 'q.overbooking-scan-scheduler';
