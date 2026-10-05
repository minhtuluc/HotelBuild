/**
 * Bề mặt F8 phần báo cáo & thông báo (HB-160).
 * `POST /reports/export` trả 202 kèm tham chiếu tác vụ; lệnh ghi giữ `Idempotency-Key` của client.
 */
import {
  adrRevparReportSchema,
  cancellationsReportSchema,
  forceMajeureReportSchema,
  listResponseSchema,
  notificationResendRequestSchema,
  notificationSummarySchema,
  occupancyReportSchema,
  operationRefSchema,
  overbookingReportSchema,
  reportExportRequestSchema,
  revenueByChannelReportSchema,
  type AdrRevparReport,
  type CancellationsReport,
  type ForceMajeureReport,
  type ListPage,
  type NotificationResendRequest,
  type NotificationSummary,
  type OccupancyReport,
  type OperationRef,
  type OverbookingReport,
  type ReportExportRequest,
  type RevenueByChannelReport,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface ReportApi {
  occupancy(query: {
    propertyId?: string;
    from: string;
    to: string;
    groupBy?: 'DAY' | 'ROOM_TYPE' | 'PROPERTY';
  }): Promise<ApiResponse<OccupancyReport>>;
  adrRevpar(query: {
    propertyId?: string;
    from: string;
    to: string;
    groupBy?: 'DAY' | 'ROOM_TYPE' | 'PROPERTY';
  }): Promise<ApiResponse<AdrRevparReport>>;
  revenueByChannel(query: {
    from: string;
    to: string;
    channelId?: string;
    propertyId?: string;
  }): Promise<ApiResponse<RevenueByChannelReport>>;
  cancellations(query: {
    from: string;
    to: string;
    ratePlanCode?: CancellationsReport['rows'][number]['ratePlanCode'];
    propertyId?: string;
  }): Promise<ApiResponse<CancellationsReport>>;
  forceMajeure(query: { from: string; to: string }): Promise<ApiResponse<ForceMajeureReport>>;
  overbooking(query: {
    propertyId?: string;
    from: string;
    to: string;
    status?: OverbookingReport['rows'][number]['status'];
  }): Promise<ApiResponse<OverbookingReport>>;
  /** Xuất bất đồng bộ: 202 kèm `operationId`/`statusUrl` (NFR-COMP-04). */
  export(input: ReportExportRequest): Promise<ApiResponse<OperationRef>>;
}

export function createReportApi(client: ApiClient): ReportApi {
  return {
    occupancy: (query) =>
      client.request({
        method: 'GET',
        path: '/reports/occupancy',
        query,
        decoder: occupancyReportSchema,
      }),
    adrRevpar: (query) =>
      client.request({
        method: 'GET',
        path: '/reports/adr-revpar',
        query,
        decoder: adrRevparReportSchema,
      }),
    revenueByChannel: (query) =>
      client.request({
        method: 'GET',
        path: '/reports/revenue-by-channel',
        query,
        decoder: revenueByChannelReportSchema,
      }),
    cancellations: (query) =>
      client.request({
        method: 'GET',
        path: '/reports/cancellations',
        query,
        decoder: cancellationsReportSchema,
      }),
    forceMajeure: (query) =>
      client.request({
        method: 'GET',
        path: '/reports/force-majeure',
        query,
        decoder: forceMajeureReportSchema,
      }),
    overbooking: (query) =>
      client.request({
        method: 'GET',
        path: '/reports/overbooking',
        query,
        decoder: overbookingReportSchema,
      }),
    export: (input) =>
      client.request({
        method: 'POST',
        path: '/reports/export',
        body: reportExportRequestSchema.parse(input),
        decoder: operationRefSchema,
      }),
  };
}

export interface NotificationApi {
  list(query?: {
    bookingId?: string;
    channel?: NotificationSummary['channel'];
    status?: NotificationSummary['status'];
    template?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<NotificationSummary>>>;
  resend(
    notificationId: string,
    input: NotificationResendRequest,
  ): Promise<ApiResponse<NotificationSummary>>;
}

export function createNotificationApi(client: ApiClient): NotificationApi {
  return {
    list: (query) =>
      client.request({
        method: 'GET',
        path: '/notifications',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(notificationSummarySchema),
      }),
    resend: (notificationId, input) =>
      client.request({
        method: 'POST',
        path: `/notifications/${encodeURIComponent(notificationId)}/resend`,
        body: notificationResendRequestSchema.parse(input),
        decoder: notificationSummarySchema,
      }),
  };
}
