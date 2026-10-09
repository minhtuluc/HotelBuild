/**
 * Lớp gọi API cho SCR-07: `GET /bookings/{bookingId}` là tuyến **cần phiên khách** (AC2: trạng thái luôn
 * đọc từ máy chủ, không suy từ URL/redirect), nên client dùng session client thật của web khách.
 */
import { createJourneyApiClient } from '@pinehill/web-session/client';
import type { JourneySession } from '@pinehill/web-session/client';
import { bookingSummarySchema } from '@pinehill/contracts';
import type { BookingSummary } from '@pinehill/contracts';

export async function fetchBooking(
  session: JourneySession,
  bookingId: string,
): Promise<BookingSummary> {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const response = await client.request({
    method: 'GET',
    path: `/bookings/${encodeURIComponent(bookingId)}`,
    decoder: bookingSummarySchema,
  });
  return response.data;
}
