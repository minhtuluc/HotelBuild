/**
 * Bề mặt F7 (HB-140): tiền sảnh, buồng phòng, khách tại quầy, chốt đối soát.
 * Lệnh 🔒 gửi `pinProtected` để client chèn `pinToken` (QĐ-01 mục 6); `PATCH` task mang `If-Match`.
 */
import {
  checkInRequestSchema,
  checkInResponseSchema,
  checkOutPreviewRequestSchema,
  checkOutPreviewSchema,
  checkOutRequestSchema,
  checkOutResponseSchema,
  guestAnonymizeRequestSchema,
  guestBlacklistRequestSchema,
  guestCreateRequestSchema,
  guestLoyaltySchema,
  guestSummarySchema,
  housekeepingTaskCreateRequestSchema,
  housekeepingTaskSchema,
  housekeepingTaskUpdateRequestSchema,
  listResponseSchema,
  noShowPreviewRequestSchema,
  noShowPreviewSchema,
  noShowRequestSchema,
  noShowResponseSchema,
  reconciliationCloseRequestSchema,
  reconciliationCloseResponseSchema,
  type CheckInRequest,
  type CheckInResponse,
  type CheckOutPreview,
  type CheckOutPreviewRequest,
  type CheckOutRequest,
  type CheckOutResponse,
  type GuestAnonymizeRequest,
  type GuestBlacklistRequest,
  type GuestCreateRequest,
  type GuestLoyalty,
  type GuestSummary,
  type HousekeepingTask,
  type HousekeepingTaskCreateRequest,
  type HousekeepingTaskUpdateRequest,
  type ListPage,
  type NoShowPreview,
  type NoShowPreviewRequest,
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
  /** Xem trước tiền no-show: không ghi, không PIN; số không ràng buộc (HB-204). */
  noShowPreview(input: NoShowPreviewRequest): Promise<ApiResponse<NoShowPreview>>;
  /** Xem trước phụ thu/số dư trả phòng: không ghi, **không** PIN; số không ràng buộc (HB-204). */
  checkOutPreview(input: CheckOutPreviewRequest): Promise<ApiResponse<CheckOutPreview>>;
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
    noShowPreview: (input) =>
      client.request({
        method: 'POST',
        path: '/front-office/no-show/preview',
        body: noShowPreviewRequestSchema.parse(input),
        decoder: noShowPreviewSchema,
      }),
    checkOutPreview: (input) =>
      client.request({
        method: 'POST',
        path: '/front-office/check-out/preview',
        body: checkOutPreviewRequestSchema.parse(input),
        decoder: checkOutPreviewSchema,
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
  /** Ghi nhận nhiệm vụ dọn/biên bản kiểm cho phòng chưa có bằng chứng sẵn sàng (HB-204, BR-FO-07). */
  createTask(input: HousekeepingTaskCreateRequest): Promise<ApiResponse<HousekeepingTask>>;
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
    createTask: (input) =>
      client.request({
        method: 'POST',
        path: '/housekeeping/tasks',
        body: housekeepingTaskCreateRequestSchema.parse(input),
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
  /** Hồ sơ khách theo id trong phạm vi; ngoài phạm vi hoặc không có ⇒ 404 (HB-204). */
  get(guestId: string): Promise<ApiResponse<GuestSummary>>;
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
    get: (guestId) =>
      client.request({
        method: 'GET',
        path: `/guests/${encodeURIComponent(guestId)}`,
        decoder: guestSummarySchema,
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
