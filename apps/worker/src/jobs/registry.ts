import { exportCleanupJob } from '../export/cleanup.job.js';
import { reportExportJob } from '../export/report-export.job.js';
import { alertsScanJob } from './alerts/alerts.job.js';
import { holdExpiryJob } from './hold-expiry/hold-expiry.job.js';
import { outboxRelayJob } from './outbox-relay/outbox-relay.job.js';
import { channelSenders } from '../noti/channels.js';
import { createNotificationSendJob } from '../noti/send.job.js';
import { smtpSettings } from '../noti/smtp.js';
import { refundPayoutJob } from './refund-payout/refund-payout.job.js';
import { noShowMarkJob } from './no-show/no-show.job.js';
import { otaInboxJob } from './ota-inbox/ota-inbox.job.js';
import { OVERBOOKING_SCAN_QUEUE } from '../queues.js';
import { overbookingScanJob } from '../overbooking/scan.job.js';
import type { JobRegistry } from './types.js';

/**
 * Nối hàng đợi → handler thật. Handler thông báo dựng **theo cấu hình của tiến trình** (cấu hình SMTP
 * nằm trong `WorkerConfig`, không handler nào tự đọc `process.env`). Hàng đợi chưa có handler rơi về log
 * mặc định của `worker-app`.
 */
export const JOB_HANDLERS: JobRegistry = {
  'q.hold-expiry': holdExpiryJob,
  'q.alerts-scan': alertsScanJob,
  'q.report-export': reportExportJob,
  'q.export-cleanup': exportCleanupJob,
  'q.outbox-relay': outboxRelayJob,
  'q.refund-payout': refundPayoutJob,
  'q.no-show-mark': noShowMarkJob,
  // HB-129 AC10/AC13: tiêu thụ `q.ota-inbox` bằng use case áp booking qua composition runtime.
  'q.ota-inbox': otaInboxJob,
  // HB-127: quét quá tải bằng đúng use case phát hiện của HB-126 qua composition runtime.
  [OVERBOOKING_SCAN_QUEUE]: overbookingScanJob,
  'q.notification-send': (data, context) =>
    createNotificationSendJob(channelSenders(smtpSettings(context.config)))(data, context),
};
