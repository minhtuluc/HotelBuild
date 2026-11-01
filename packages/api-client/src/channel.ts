/**
 * Bề mặt F6 CHAN (HB-120): đồng bộ kênh, ánh xạ, đóng bán, inbox OTA và các đường đọc/retry cho
 * SCR-40/41/42. Lệnh ghi để `ApiClient` sinh `Idempotency-Key` khi caller không truyền; retry cùng
 * payload phải truyền lại **đúng** key cũ + `If-Match` đã đọc (api.md §1.6, AC4).
 */
import {
  channelMappingPutRequestSchema,
  channelMappingsViewSchema,
  channelSyncRequestSchema,
  channelSyncStatusViewSchema,
  listResponseSchema,
  operationRefSchema,
  otaBookingFlagRequestSchema,
  otaBookingSchema,
  outboxDeliverySchema,
  salesClosureRequestSchema,
  salesClosureViewSchema,
  type ChannelMappingPutRequest,
  type ChannelMappingsView,
  type ChannelSyncRequest,
  type ChannelSyncStatusView,
  type ListPage,
  type OperationRef,
  type OtaBooking,
  type OtaBookingFlagRequest,
  type OutboxDelivery,
  type SalesClosureRequest,
  type SalesClosureView,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export type OtaBookingsFilter = {
  limit?: number;
  cursor?: string;
  q?: string;
  from?: string;
  to?: string;
  status?: OtaBooking['status'];
};

export type OutboxDeliveriesFilter = {
  limit?: number;
  cursor?: string;
  status?: OutboxDelivery['status'];
  consumerKey?: string;
};

export interface ChannelApi {
  /** 202 + `operationId`/`statusUrl`; đọc kết quả qua `GET /operations/{operationId}`. */
  sync(
    channelId: string,
    input: ChannelSyncRequest,
    options?: { idempotencyKey?: string },
  ): Promise<ApiResponse<OperationRef>>;
  /** `PUT` upsert theo `(channelId, roomTypeId)`; cần `If-Match` khi sửa cấu hình đã có. */
  putMapping(
    channelId: string,
    input: ChannelMappingPutRequest,
    ifMatch: string,
  ): Promise<ApiResponse<ChannelMappingsView>>;
  setSalesClosure(
    channelId: string,
    input: SalesClosureRequest,
    options?: { idempotencyKey?: string },
  ): Promise<ApiResponse<SalesClosureView>>;
  otaBookings(
    channelId: string,
    query?: OtaBookingsFilter,
  ): Promise<ApiResponse<ListPage<OtaBooking>>>;
  syncStatus(channelId: string): Promise<ApiResponse<ChannelSyncStatusView>>;
  outboxDeliveries(
    channelId: string,
    query?: OutboxDeliveriesFilter,
  ): Promise<ApiResponse<ListPage<OutboxDelivery>>>;
  /** Giữ nguyên `eventId` + `consumerKey` của delivery; chỉ enqueue lại, không đổi payload. */
  retryDelivery(
    channelId: string,
    deliveryId: string,
    options?: { idempotencyKey?: string },
  ): Promise<ApiResponse<OperationRef>>;
  flagOtaBooking(
    channelId: string,
    bookingId: string,
    input: OtaBookingFlagRequest,
    ifMatch: string,
  ): Promise<ApiResponse<OtaBooking>>;
}

export function createChannelApi(client: ApiClient): ChannelApi {
  return {
    sync: (channelId, input, options) =>
      client.request({
        method: 'POST',
        path: `/channels/${encodeURIComponent(channelId)}/sync`,
        body: channelSyncRequestSchema.parse(input),
        ...(options?.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
        decoder: operationRefSchema,
      }),
    putMapping: (channelId, input, ifMatch) =>
      client.request({
        method: 'PUT',
        path: `/channels/${encodeURIComponent(channelId)}/mappings`,
        body: channelMappingPutRequestSchema.parse(input),
        ifMatch,
        decoder: channelMappingsViewSchema,
      }),
    setSalesClosure: (channelId, input, options) =>
      client.request({
        method: 'POST',
        path: `/channels/${encodeURIComponent(channelId)}/sales-closure`,
        body: salesClosureRequestSchema.parse(input),
        ...(options?.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
        decoder: salesClosureViewSchema,
      }),
    otaBookings: (channelId, query) =>
      client.request({
        method: 'GET',
        path: `/channels/${encodeURIComponent(channelId)}/ota-bookings`,
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(otaBookingSchema),
      }),
    syncStatus: (channelId) =>
      client.request({
        method: 'GET',
        path: `/channels/${encodeURIComponent(channelId)}/sync-status`,
        decoder: channelSyncStatusViewSchema,
      }),
    outboxDeliveries: (channelId, query) =>
      client.request({
        method: 'GET',
        path: `/channels/${encodeURIComponent(channelId)}/outbox-deliveries`,
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(outboxDeliverySchema),
      }),
    retryDelivery: (channelId, deliveryId, options) =>
      client.request({
        method: 'POST',
        path: `/channels/${encodeURIComponent(channelId)}/outbox-deliveries/${encodeURIComponent(deliveryId)}/retry`,
        ...(options?.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
        decoder: operationRefSchema,
      }),
    flagOtaBooking: (channelId, bookingId, input, ifMatch) =>
      client.request({
        method: 'POST',
        path: `/channels/${encodeURIComponent(channelId)}/ota-bookings/${encodeURIComponent(bookingId)}/duplicate-flag`,
        body: otaBookingFlagRequestSchema.parse(input),
        ifMatch,
        decoder: otaBookingSchema,
      }),
  };
}
