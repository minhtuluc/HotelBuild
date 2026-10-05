/**
 * Bề mặt F7 (HB-140): tiền sảnh, buồng phòng, khách tại quầy, chốt đối soát.
 * Lệnh 🔒 gửi `pinProtected` để client chèn `pinToken` (QĐ-01 mục 6); `PATCH` task mang `If-Match`.
 */
import {
  checkInRequestSchema,
  checkInResponseSchema,
  checkOutRequestSchema,
  checkOutResponseSchema,
  guestAnonymizeRequestSchema,
  guestBlacklistRequestSchema,
  guestCreateRequestSchema,
  guestLoyaltySchema,
  guestSummarySchema,
  housekeepingTaskSchema,
  housekeepingTaskUpdateRequestSchema,
  listResponseSchema,
  noShowRequestSchema,
  noShowResponseSchema,
  reconciliationCloseRequestSchema,
  reconciliationCloseResponseSchema,
  type CheckInRequest,
  type CheckInResponse,
  type CheckOutRequest,
  type CheckOutResponse,
  type GuestAnonymizeRequest,
  type GuestBlacklistRequest,
  type GuestCreateRequest,
  type GuestLoyalty,
  type GuestSummary,
  type HousekeepingTask,
  type HousekeepingTaskUpdateRequest,
  type ListPage,
  type NoShowRequest,
  type NoShowResponse,
  type ReconciliationCloseRequest,
  type ReconciliationCloseResponse,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface FrontOfficeApi {
  checkIn(input: CheckInRequest): Promise<ApiResponse<CheckInResponse>>;
  /** 🔒 Thu phát sinh khi trả phòng; PIN gắn người, hành động và amount (BR-RBAC-05). */
  checkOut(input: CheckOutRequest): Promise<ApiResponse<CheckOutResponse>>;
  noShow(input: NoShowRequest): Promise<ApiResponse<NoShowResponse>>;
  /** 🔒 Chốt ca/ngày theo (người thu, ngày VN) — BR-PAY-06,10. */
  closeReconciliation(
    input: ReconciliationCloseRequest,
  ): Promise<ApiResponse<ReconciliationCloseResponse>>;
}

export function createFrontOfficeApi(client: ApiClient): FrontOfficeApi {
  return {
    checkIn: (input) =>
      client.request({
        method: 'POST',
        path: '/front-office/check-in',
        body: checkInRequestSchema.parse(input),
        decoder: checkInResponseSchema,
      }),
    checkOut: (input) =>
      client.request({
        method: 'POST',
        path: '/front-office/check-out',
        body: checkOutRequestSchema.parse(input),
        pinProtected: true,
        decoder: checkOutResponseSchema,
      }),
    noShow: (input) =>
      client.request({
        method: 'POST',
        path: '/front-office/no-show',
        body: noShowRequestSchema.parse(input),
        decoder: noShowResponseSchema,
      }),
    closeReconciliation: (input) =>
      client.request({
        method: 'POST',
        path: '/reconciliation/daily/close',
        body: reconciliationCloseRequestSchema.parse(input),
        pinProtected: true,
        decoder: reconciliationCloseResponseSchema,
      }),
  };
}

export interface HousekeepingApi {
  listTasks(query: {
    propertyId?: string;
    businessDate: string;
    status?: HousekeepingTask['status'];
    assignedTo?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<HousekeepingTask>>>;
  updateTask(
    taskId: string,
    input: HousekeepingTaskUpdateRequest,
    ifMatch: string,
  ): Promise<ApiResponse<HousekeepingTask>>;
}

export function createHousekeepingApi(client: ApiClient): HousekeepingApi {
  return {
    listTasks: (query) =>
      client.request({
        method: 'GET',
        path: '/housekeeping/tasks',
        query,
        decoder: listResponseSchema(housekeepingTaskSchema),
      }),
    updateTask: (taskId, input, ifMatch) =>
      client.request({
        method: 'PATCH',
        path: `/housekeeping/tasks/${encodeURIComponent(taskId)}`,
        body: housekeepingTaskUpdateRequestSchema.parse(input),
        ifMatch,
        decoder: housekeepingTaskSchema,
      }),
  };
}

export interface GuestApi {
  list(query?: {
    q?: string;
    loyaltyTier?: GuestSummary['loyaltyTier'];
    blacklisted?: boolean;
    propertyId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<GuestSummary>>>;
  create(input: GuestCreateRequest): Promise<ApiResponse<GuestSummary>>;
  /** Ẩn danh hoá theo yêu cầu khách — không xoá cứng (BR-CRM-05, §2.14). */
  anonymize(guestId: string, input: GuestAnonymizeRequest): Promise<ApiResponse<GuestSummary>>;
  loyalty(guestId: string): Promise<ApiResponse<GuestLoyalty>>;
  addBlacklist(guestId: string, input: GuestBlacklistRequest): Promise<ApiResponse<GuestSummary>>;
  removeBlacklist(guestId: string, reason: string): Promise<ApiResponse<undefined>>;
}

export function createGuestApi(client: ApiClient): GuestApi {
  return {
    list: (query) =>
      client.request({
        method: 'GET',
        path: '/guests',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(guestSummarySchema),
      }),
    create: (input) =>
      client.request({
        method: 'POST',
        path: '/guests',
        body: guestCreateRequestSchema.parse(input),
        decoder: guestSummarySchema,
      }),
    anonymize: (guestId, input) =>
      client.request({
        method: 'POST',
        path: `/guests/${encodeURIComponent(guestId)}/anonymize`,
        body: guestAnonymizeRequestSchema.parse(input),
        decoder: guestSummarySchema,
      }),
    loyalty: (guestId) =>
      client.request({
        method: 'GET',
        path: `/guests/${encodeURIComponent(guestId)}/loyalty`,
        decoder: guestLoyaltySchema,
      }),
    addBlacklist: (guestId, input) =>
      client.request({
        method: 'POST',
        path: `/guests/${encodeURIComponent(guestId)}/blacklist`,
        body: guestBlacklistRequestSchema.parse(input),
        decoder: guestSummarySchema,
      }),
    removeBlacklist: (guestId, reason) =>
      client.requestVoid({
        method: 'DELETE',
        path: `/guests/${encodeURIComponent(guestId)}/blacklist`,
        query: { reason },
      }),
  };
}
