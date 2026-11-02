/**
 * HB-131 — hợp đồng phía API với tiến trình worker đồng bộ kênh.
 *
 * API **không** gọi HTTP OTA và **không** chạy job: mọi lệnh ghi CHAN để lại một hàng `operations`
 * (`kind` khai ở đây) hoặc một `event_deliveries` bền, và `q.channel-sync` xử lý ở lượt quét kế tiếp.
 * Vì worker không được import mã nguồn API (ranh giới build ADR-018), các hằng số dưới đây được worker
 * sao lại **nguyên văn** trong `apps/worker/src/jobs/channel-sync/contract.ts`; đổi một bên là đổi hợp
 * đồng vận chuyển nên phải đổi cả hai cùng lúc.
 */

/** Tên hàng đợi BullMQ của nhịp đồng bộ (đã có trong `queues.ts`; HB-131 thêm vào danh sách lặp). */
export const CHANNEL_SYNC_QUEUE = 'q.channel-sync';

/** Khoá consumer bền trong `event_deliveries` — cũng là `consumerKey` trả ở API monitoring. */
export const CHANNEL_SYNC_CONSUMER = 'channel-sync';

/** Loại `outbox_events` mà lượt đồng bộ tiêu thụ (tồn/giá đã commit của một kênh). */
export const CHANNEL_INVENTORY_EVENT = 'channel.inventory.changed';

/** Loại tác vụ bất đồng bộ CHAN trong `operations.kind` (migration 0010 mở CHECK). */
export const CHANNEL_SYNC_OPERATION_KINDS = ['CHANNEL_SYNC', 'CHANNEL_DELIVERY_RETRY'] as const;

export type ChannelSyncOperationKind = (typeof CHANNEL_SYNC_OPERATION_KINDS)[number];

/** api.md §6.4 — `statusUrl` của mọi tác vụ CHAN dùng lại tuyến theo dõi chung. */
export const channelOperationStatusUrl = (operationId: string): string =>
  `/api/v1/operations/${operationId}`;
