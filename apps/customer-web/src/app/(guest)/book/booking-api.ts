/**
 * Lớp gọi API cho SCR-04/05 (đặt phòng): `POST /bookings` là tuyến **cần phiên khách**, nên client phải
 * dùng session client thật của web khách để BFF gắn access token — không dùng session rỗng như tuyến công khai.
 */
import { createJourneyApiClient } from '@pinehill/web-session/client';
import type { JourneySession } from '@pinehill/web-session/client';
import {
  bookingCreateRequestSchema,
  bookingSummarySchema,
  quoteRequestSchema,
  quoteSchema,
} from '@pinehill/contracts';
import type {
  BookingCreateRequest,
  BookingSummary,
  Quote,
  QuoteRequest,
} from '@pinehill/contracts';

export async function createBooking(
  session: JourneySession,
  request: BookingCreateRequest,
): Promise<BookingSummary> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'POST',
    path: '/bookings',
    body: bookingCreateRequestSchema.parse(request),
    decoder: bookingSummarySchema,
  });
  return response.data;
}

/**
 * Báo giá **trong cùng phiên** với lệnh đặt phòng: API giả (và máy chủ thật) ràng buộc quote ↔ booking
 * cùng một chủ thể, nên màn xác nhận phải xin giá bằng chính session client của khách.
 */
export async function fetchQuoteWithSession(
  session: JourneySession,
  request: QuoteRequest,
): Promise<Quote> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'POST',
    path: '/quotes',
    body: quoteRequestSchema.parse(request),
    decoder: quoteSchema,
  });
  return response.data;
}
