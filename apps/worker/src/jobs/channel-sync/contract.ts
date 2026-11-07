/**
 * HB-131 — hợp đồng phía worker với API CHAN. **Sao nguyên văn** từ
 * `apps/api/src/worker-runtime/channel-sync.ts`: worker không được import mã nguồn API (ranh giới build
 * ADR-018), nên hai bên giữ cùng một bộ hằng số và đổi cùng lúc khi hợp đồng vận chuyển đổi.
 */

export const CHANNEL_SYNC_QUEUE = 'q.channel-sync';

/** Tên job của nhịp lặp và của lượt chạy tay (chỉ để tra vết — handler nhận payload). */
export const CHANNEL_SYNC_JOB = 'channel-sync';

/** Khoá consumer bền trong `event_deliveries` và `payload_json.consumerKey` của API. */
export const CHANNEL_SYNC_CONSUMER = 'channel-sync';

/** Loại `outbox_events` được tiêu thụ: tồn/giá của một kênh đã commit. */
export const CHANNEL_INVENTORY_EVENT = 'channel.inventory.changed';

/** Id scheduler BullMQ — trùng qua restart thì `upsertJobScheduler` cập nhật thay vì nhân đôi. */
export const CHANNEL_SYNC_SCHEDULER_ID = 'q.channel-sync-scheduler';

/** `operations.kind` mà lượt quét nhận xử lý (migration 0010 mở CHECK). */
export const CHANNEL_SYNC_OPERATION_KINDS = ['CHANNEL_SYNC', 'CHANNEL_DELIVERY_RETRY'] as const;

/** Mã lỗi **đã che** ghi vào `channels.last_sync_error`/`event_deliveries.last_error` (BR-CHAN-07). */
export const CHANNEL_SYNC_FAILED = 'E_CHAN_SYNC_FAILED';

/** BR-CHAN-07: ba lần thất bại liên tiếp ⇒ `DEGRADED` + cảnh báo MANAGER (tách khỏi trần 5 lượt DLQ HB-130). */
export const DEGRADED_AFTER_FAILURES = 3;

/** Trần lượt vận chuyển của consumer — gương của `OUTBOX_MAX_TRANSPORT_ATTEMPTS` (HB-130). */
export const DELIVERY_MAX_ATTEMPTS = 5;

/** Kênh OTA có quota riêng; kênh trực tiếp bán theo tồn chung và không nằm trong lượt đẩy định kỳ. */
export const OTA_CHANNEL_CODES = ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'] as const;

/** Số đêm của ảnh tồn đẩy sang OTA. */
export const SNAPSHOT_HORIZON_DAYS = 30;

/** Khoá SystemSetting của nhịp quét và địa chỉ adapter (BR-SYS-02, NFR-REL-03). */
export const INTERVAL_SETTING_KEY = 'job.channelSync.intervalSeconds';
export const SIMULATOR_SETTING_KEY = 'chan.ota.simulator.baseUrl';
export const MANAGER_RECIPIENT_SETTING_KEY = 'alerts.recipient.manager';

/** Nhịp mặc định khi SystemSetting chưa có hoặc không đọc được. */
export const DEFAULT_INTERVAL_SECONDS = 300;
