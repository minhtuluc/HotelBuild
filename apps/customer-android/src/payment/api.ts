import type { ApiClient } from '@pinehill/api-client';
import {
  bookingSummarySchema,
  bookingBalanceSchema,
  paymentSchema,
  paymentStatusViewSchema,
  onlinePaymentCreateRequestSchema,
} from '@pinehill/contracts';
import type { PaymentPorts } from './flow';
/** Guest session client only. Financial POST has no automatic network retry. */
export function paymentPorts(client: ApiClient, bookingId: string): PaymentPorts {
  const base = '/bookings/' + encodeURIComponent(bookingId);
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
          path: base + '/balance',
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
          path: '/payments/' + encodeURIComponent(id) + '/status',
          decoder: paymentStatusViewSchema,
          signal,
          maxAttempts: 1,
        })
      ).data;
    },
  };
}
