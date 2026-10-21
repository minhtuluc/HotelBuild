/**
 * Nối lớp thuần SCR-81/82 (HB-114) với client đã có access token của phiên khách.
 * Không nhận/trả token ra ngoài — chỉ dùng `Session.apiClient()` (như `hold-api.ts`).
 */
import { createBookingApi, createQuoteApi, type ApiClient } from '@pinehill/api-client';
import type { CancelApi } from './cancel';
import type { RescheduleApi } from './reschedule';

export interface BookingActionsApi extends CancelApi, RescheduleApi {}

export function bookingActionsFrom(client: ApiClient): BookingActionsApi {
  const bookings = createBookingApi(client);
  const quotes = createQuoteApi(client);
  return {
    preview: async (bookingId, request) => (await bookings.cancelPreview(bookingId, request)).data,
    cancel: async (bookingId, request) => (await bookings.cancel(bookingId, request)).data,
    reschedule: async (bookingId, request) => (await bookings.reschedule(bookingId, request)).data,
    quote: async (request) => (await quotes.quote(request)).data,
  };
}
