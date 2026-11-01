/**
 * Bề mặt F6 OVER (HB-120): ca quá tải, phương án điều chuyển, ghép phòng, chi bồi thường và các
 * đường đọc phục vụ chuyển việc. Lệnh sửa đối tượng đã tồn tại **bắt buộc** `If-Match` (truyền
 * `etag` đọc gần nhất); create thì không. Retry khi timeout dùng lại key + payload + version cũ
 * (api.md §1.6, AC4); tra ý định ghi bằng `GET` kèm `idempotencyKey` thay vì tạo key mới (AC12).
 */
import {
  bookingRelocationOptionsSchema,
  compensationPaymentCreateRequestSchema,
  compensationPaymentSchema,
  compensationPaymentsViewSchema,
  overbookingAlertsViewSchema,
  overbookingCaseDetailSchema,
  overbookingCaseListSchema,
  overbookingResolveRequestSchema,
  overbookingResolveResponseSchema,
  relocationPlanRequestSchema,
  relocationPlanSchema,
  roomMergeApproveRequestSchema,
  roomMergeConsentRequestSchema,
  roomMergeRequestSchema,
  roomMergeSchema,
  roomMergeViewSchema,
  roomMoveApproveRequestSchema,
  roomMoveCreateRequestSchema,
  roomMoveSchema,
  roomMoveViewSchema,
  type BookingRelocationOptions,
  type CompensationPayment,
  type CompensationPaymentCreateRequest,
  type CompensationPaymentsView,
  type OverbookingAlertsView,
  type OverbookingCaseDetail,
  type OverbookingCaseList,
  type OverbookingCaseStatus,
  type OverbookingResolveRequest,
  type OverbookingResolveResponse,
  type RelocationPlan,
  type RelocationPlanRequest,
  type RoomMerge,
  type RoomMergeApproveRequest,
  type RoomMergeConsentRequest,
  type RoomMergeRequest,
  type RoomMergeView,
  type RoomMove,
  type RoomMoveApproveRequest,
  type RoomMoveCreateRequest,
  type RoomMoveView,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export type OverbookingCasesFilter = {
  limit?: number;
  cursor?: string;
  propertyId?: string;
  status?: OverbookingCaseStatus;
  dateFrom?: string;
  dateTo?: string;
  roomTypeId?: string;
  overdueOnly?: boolean;
};

export type OverbookingAlertsFilter = {
  limit?: number;
  cursor?: string;
  propertyId?: string;
  date?: string;
  overdueOnly?: boolean;
};

/** Options của lệnh sửa đối tượng đã tồn tại: `etag` là `ETag` đọc gần nhất. */
export interface VersionedOptions {
  etag: string;
  idempotencyKey?: string;
}

/** Tra ý định ghi theo `Idempotency-Key` khi timeout chưa rõ kết quả (không tạo key mới). */
export type WriteIntentQuery = {
  idempotencyKey?: string;
};

export interface OverbookingApi {
  listCases(query?: OverbookingCasesFilter): Promise<ApiResponse<OverbookingCaseList>>;
  getCase(
    caseId: string,
    query?: { includeCandidates?: boolean },
  ): Promise<ApiResponse<OverbookingCaseDetail>>;
  /** Trả phương án `PROPOSED`, chưa gán phòng. */
  planRelocation(
    caseId: string,
    input: RelocationPlanRequest,
    options: VersionedOptions,
  ): Promise<ApiResponse<RelocationPlan>>;
  resolveCase(
    caseId: string,
    input: OverbookingResolveRequest,
    options: VersionedOptions,
  ): Promise<ApiResponse<OverbookingResolveResponse>>;
  createMove(
    input: RoomMoveCreateRequest,
    options?: { idempotencyKey?: string },
  ): Promise<ApiResponse<RoomMove>>;
  getMove(roomMoveId: string, query?: WriteIntentQuery): Promise<ApiResponse<RoomMoveView>>;
  /** 🔒 PIN; duyệt chi phí bồi thường/đưa đón (BR-OVER-06). */
  approveMove(
    roomMoveId: string,
    input: RoomMoveApproveRequest,
    options: VersionedOptions,
  ): Promise<ApiResponse<RoomMove>>;
  /** 🔒 PIN; thực thi trong một TX, cần version hiện hành. */
  executeMove(roomMoveId: string, options: VersionedOptions): Promise<ApiResponse<RoomMove>>;
  /** 🔒 PIN + ACCOUNTANT: số tiền lấy từ quyết định đã duyệt, client không khai `amount`. */
  createCompensation(
    roomMoveId: string,
    input: CompensationPaymentCreateRequest,
    options: VersionedOptions,
  ): Promise<ApiResponse<CompensationPayment>>;
  listCompensations(roomMoveId: string): Promise<ApiResponse<CompensationPaymentsView>>;
  createMerge(
    input: RoomMergeRequest,
    options?: { idempotencyKey?: string },
  ): Promise<ApiResponse<RoomMerge>>;
  getMerge(roomMergeId: string, query?: WriteIntentQuery): Promise<ApiResponse<RoomMergeView>>;
  recordMergeConsent(
    roomMergeId: string,
    input: RoomMergeConsentRequest,
    options: VersionedOptions,
  ): Promise<ApiResponse<RoomMerge>>;
  approveMerge(
    roomMergeId: string,
    input: RoomMergeApproveRequest,
    options: VersionedOptions,
  ): Promise<ApiResponse<RoomMerge>>;
  executeMerge(roomMergeId: string, options: VersionedOptions): Promise<ApiResponse<RoomMerge>>;
  relocationOptions(
    bookingId: string,
    query?: { overbookingCaseId?: string; idempotencyKey?: string },
  ): Promise<ApiResponse<BookingRelocationOptions>>;
  alerts(query?: OverbookingAlertsFilter): Promise<ApiResponse<OverbookingAlertsView>>;
}

export function createOverbookingApi(client: ApiClient): OverbookingApi {
  return {
    listCases: (query) =>
      client.request({
        method: 'GET',
        path: '/overbooking-cases',
        ...(query === undefined ? {} : { query }),
        decoder: overbookingCaseListSchema,
      }),
    getCase: (caseId, query) =>
      client.request({
        method: 'GET',
        path: `/overbooking-cases/${encodeURIComponent(caseId)}`,
        ...(query === undefined ? {} : { query }),
        decoder: overbookingCaseDetailSchema,
      }),
    planRelocation: (caseId, input, options) =>
      client.request({
        method: 'POST',
        path: `/overbooking-cases/${encodeURIComponent(caseId)}/relocation-plan`,
        body: relocationPlanRequestSchema.parse(input),
        ifMatch: options.etag,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: relocationPlanSchema,
      }),
    resolveCase: (caseId, input, options) =>
      client.request({
        method: 'POST',
        path: `/overbooking-cases/${encodeURIComponent(caseId)}/resolve`,
        body: overbookingResolveRequestSchema.parse(input),
        ifMatch: options.etag,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: overbookingResolveResponseSchema,
      }),
    createMove: (input, options) =>
      client.request({
        method: 'POST',
        path: '/room-moves',
        body: roomMoveCreateRequestSchema.parse(input),
        ...(options?.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
        decoder: roomMoveSchema,
      }),
    getMove: (roomMoveId, query) =>
      client.request({
        method: 'GET',
        path: `/room-moves/${encodeURIComponent(roomMoveId)}`,
        ...(query === undefined ? {} : { query }),
        decoder: roomMoveViewSchema,
      }),
    approveMove: (roomMoveId, input, options) =>
      client.request({
        method: 'POST',
        path: `/room-moves/${encodeURIComponent(roomMoveId)}/approve`,
        body: roomMoveApproveRequestSchema.parse(input),
        ifMatch: options.etag,
        pinProtected: true,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: roomMoveSchema,
      }),
    executeMove: (roomMoveId, options) =>
      client.request({
        method: 'POST',
        path: `/room-moves/${encodeURIComponent(roomMoveId)}/execute`,
        body: {},
        ifMatch: options.etag,
        pinProtected: true,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: roomMoveSchema,
      }),
    createCompensation: (roomMoveId, input, options) =>
      client.request({
        method: 'POST',
        path: `/room-moves/${encodeURIComponent(roomMoveId)}/compensation-payments`,
        body: compensationPaymentCreateRequestSchema.parse(input),
        ifMatch: options.etag,
        pinProtected: true,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: compensationPaymentSchema,
      }),
    listCompensations: (roomMoveId) =>
      client.request({
        method: 'GET',
        path: `/room-moves/${encodeURIComponent(roomMoveId)}/compensation-payments`,
        decoder: compensationPaymentsViewSchema,
      }),
    createMerge: (input, options) =>
      client.request({
        method: 'POST',
        path: '/room-merges',
        body: roomMergeRequestSchema.parse(input),
        ...(options?.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: options.idempotencyKey }),
        decoder: roomMergeSchema,
      }),
    getMerge: (roomMergeId, query) =>
      client.request({
        method: 'GET',
        path: `/room-merges/${encodeURIComponent(roomMergeId)}`,
        ...(query === undefined ? {} : { query }),
        decoder: roomMergeViewSchema,
      }),
    recordMergeConsent: (roomMergeId, input, options) =>
      client.request({
        method: 'POST',
        path: `/room-merges/${encodeURIComponent(roomMergeId)}/consent`,
        body: roomMergeConsentRequestSchema.parse(input),
        ifMatch: options.etag,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: roomMergeSchema,
      }),
    approveMerge: (roomMergeId, input, options) =>
      client.request({
        method: 'POST',
        path: `/room-merges/${encodeURIComponent(roomMergeId)}/approve`,
        body: roomMergeApproveRequestSchema.parse(input),
        ifMatch: options.etag,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: roomMergeSchema,
      }),
    executeMerge: (roomMergeId, options) =>
      client.request({
        method: 'POST',
        path: `/room-merges/${encodeURIComponent(roomMergeId)}/execute`,
        ifMatch: options.etag,
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        decoder: roomMergeSchema,
      }),
    relocationOptions: (bookingId, query) =>
      client.request({
        method: 'GET',
        path: `/bookings/${encodeURIComponent(bookingId)}/relocation-options`,
        ...(query === undefined ? {} : { query }),
        decoder: bookingRelocationOptionsSchema,
      }),
    alerts: (query) =>
      client.request({
        method: 'GET',
        path: '/overbooking-alerts',
        ...(query === undefined ? {} : { query }),
        decoder: overbookingAlertsViewSchema,
      }),
  };
}
