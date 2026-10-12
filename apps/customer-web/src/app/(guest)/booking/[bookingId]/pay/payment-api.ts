import {
  bookingBalanceSchema,
  bookingSummarySchema,
  onlinePaymentCreateRequestSchema,
  paymentSchema,
  paymentStatusViewSchema,
} from '@pinehill/contracts';
import { createJourneyApiClient, type JourneySession } from '@pinehill/web-session/client';
import type { PaymentPorts } from './payment-flow';
/** Same-origin authenticated BFF; bounded reads and never automatic retries of a money write. */
export function paymentPorts(session: JourneySession, bookingId: string): PaymentPorts {
  const client = createJourneyApiClient({ baseUrl: window.location.origin, session });
  const base = `/bookings/${encodeURIComponent(bookingId)}`;
  return {
    async read(signal) {
      const [booking, balance] = await Promise.all([
        client.request({
          method: 'GET',
          path: base,
          decoder: bookingSummarySchema,
          signal,
          maxAttempts: 1,
        }),
        client.request({
          method: 'GET',
          path: `${base}/balance`,
          decoder: bookingBalanceSchema,
          signal,
          maxAttempts: 1,
        }),
      ]);
      return { booking: booking.data, balance: balance.data };
    },
    async create(body, key, signal) {
      return (
        await client.request({
          method: 'POST',
          path: '/payments/online',
          body: onlinePaymentCreateRequestSchema.parse(body),
          decoder: paymentSchema,
          idempotencyKey: key,
          signal,
          maxAttempts: 1,
        })
      ).data;
    },
    async status(id, signal) {
      return (
        await client.request({
          method: 'GET',
          path: `/payments/${encodeURIComponent(id)}/status`,
          decoder: paymentStatusViewSchema,
          signal,
          maxAttempts: 1,
        })
      ).data;
    },
  };
}
