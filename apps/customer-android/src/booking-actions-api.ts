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
    preview: async (bookingId, request) => {
      const response = await bookings.cancelPreview(bookingId, request);
      if (response.etag === undefined) throw new Error('Cancel preview without ETag');
      return { preview: response.data, tag: response.etag };
    },
    cancel: async (bookingId, request, ifMatch) =>
      (await bookings.cancel(bookingId, request, ifMatch)).data,
    reschedule: async (bookingId, request, ifMatch) =>
      (await bookings.reschedule(bookingId, request, ifMatch)).data,
    quote: async (request) => (await quotes.quote(request)).data,
  };
}
