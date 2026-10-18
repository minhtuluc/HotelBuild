import { exportCleanupJob } from '../export/cleanup.job.js';
import { reportExportJob } from '../export/report-export.job.js';
import { holdExpiryJob } from './hold-expiry/hold-expiry.job.js';
import { outboxRelayJob } from './outbox-relay/outbox-relay.job.js';
import { channelSenders } from '../noti/channels.js';
import { createNotificationSendJob } from '../noti/send.job.js';
import { smtpSettings } from '../noti/smtp.js';
import type { JobRegistry } from './types.js';

/**
 * Nối hàng đợi → handler thật. Handler thông báo dựng **theo cấu hình của tiến trình** (cấu hình SMTP
 * nằm trong `WorkerConfig`, không handler nào tự đọc `process.env`). Hàng đợi chưa có handler rơi về log
 * mặc định của `worker-app`.
 */
export const JOB_HANDLERS: JobRegistry = {
  'q.hold-expiry': holdExpiryJob,
  'q.report-export': reportExportJob,
  'q.export-cleanup': exportCleanupJob,
  'q.outbox-relay': outboxRelayJob,
  'q.notification-send': (data, context) =>
    createNotificationSendJob(channelSenders(smtpSettings(context.config)))(data, context),
};
