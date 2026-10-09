/**
 * Lớp gọi API cho SCR-09/SCR-10: `GET /bookings` và `GET /bookings/{id}/balance` là tuyến **cần phiên
 * khách**, nên dùng session client thật của web khách để BFF gắn access token; máy chủ là nơi giới hạn
 * "chỉ booking của chính khách" (UC-BOOK-07) — giao diện không tự lọc theo chủ thể.
 */
import { createJourneyApiClient } from '@pinehill/web-session/client';
import type { JourneySession } from '@pinehill/web-session/client';
import {
  bookingBalanceSchema,
  bookingSummarySchema,
  cancelPreviewRequestSchema,
  cancelPreviewSchema,
  cancelRequestSchema,
  cancelResponseSchema,
  listResponseSchema,
} from '@pinehill/contracts';
import type {
  BookingBalance,
  BookingSummary,
  CancelPreview,
  CancelPreviewRequest,
  CancelRequest,
  CancelResponse,
  ListPage,
} from '@pinehill/contracts';
import type { BookingFilters } from './model';

/** Số dòng mỗi trang: khớp `listQuerySchema` (1…100). */
const PAGE_SIZE = 20;

export async function fetchMyBookings(
  session: JourneySession,
  filters: BookingFilters,
  cursor: string | null,
): Promise<ListPage<BookingSummary>> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const query: Record<string, string | number> = { limit: PAGE_SIZE };
  if (filters.status !== '') query.status = filters.status;
  if (filters.q !== '') query.q = filters.q;
  if (cursor !== null) query.cursor = cursor;
  const response = await client.request({
    method: 'GET',
    path: '/bookings',
    query,
    decoder: listResponseSchema(bookingSummarySchema),
  });
  return response.data;
}

export async function fetchBookingBalance(
  session: JourneySession,
  bookingId: string,
): Promise<BookingBalance> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'GET',
    path: `/bookings/${encodeURIComponent(bookingId)}/balance`,
    decoder: bookingBalanceSchema,
  });
  return response.data;
}

/**
 * SCR-11: xem trước tiền hoàn (`POST .../cancel-preview`) rồi mới huỷ (`POST .../cancel`). Không có tuyến
 * nào cho giao diện tự tính tiền — mọi con số trả về được in nguyên (ADR-018).
 */
export async function fetchCancelPreview(
  session: JourneySession,
  bookingId: string,
  request: CancelPreviewRequest,
): Promise<CancelPreview> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'POST',
    path: `/bookings/${encodeURIComponent(bookingId)}/cancel-preview`,
    body: cancelPreviewRequestSchema.parse(request),
    decoder: cancelPreviewSchema,
  });
  return response.data;
}

export async function cancelBooking(
  session: JourneySession,
  bookingId: string,
  request: CancelRequest,
): Promise<CancelResponse> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'POST',
    path: `/bookings/${encodeURIComponent(bookingId)}/cancel`,
    body: cancelRequestSchema.parse(request),
    decoder: cancelResponseSchema,
  });
  return response.data;
}
