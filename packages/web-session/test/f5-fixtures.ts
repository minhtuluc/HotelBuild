import { afterEach, beforeEach, expect } from 'vitest';
import {
  ApiClient,
  createBookingApi,
  createPaymentApi,
  createQuoteApi,
  createRefundApi,
} from '@pinehill/api-client';
import {
  tokenPairSchema,
  pinTokenSchema,
  type BookingSummary,
  type BookingCreateRequest,
} from '@pinehill/contracts';
import { startFakeApi } from '../../../tests/e2e/fake-api/server.js';
import { quoteInput, bookingInput } from './journey-fixtures.js';
export function setup() {
  let running: Awaited<ReturnType<typeof startFakeApi>>;
  beforeEach(async () => {
    running = await startFakeApi('http://127.0.0.1:0/api/v1');
  });
  afterEach(async () => {
    running.server.closeAllConnections();
    await new Promise<void>((resolve) => running.server.close(() => resolve()));
  });
  const origin = () => new URL(running.url).origin;
  async function raw(
    path: string,
    body?: unknown,
    token?: string,
    method = body === undefined ? 'GET' : 'POST',
    key: string = crypto.randomUUID(),
  ) {
    return fetch((path.startsWith('/__') ? origin() : running.url) + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function actor(
    name = 'synthetic-f5-guest',
    role?: string,
    propertyIds = ['journey-standard'],
  ) {
    const response = await raw(
      role ? '/auth/login' : '/guest-auth/login',
      role
        ? { username: name, password: 'Synthetic-password' }
        : { phone: name, password: 'Synthetic-password' },
    );
    const session = tokenPairSchema.parse(await response.json());
    let pin: string | null = null;
    const client = new ApiClient({
      baseUrl: running.url,
      getAccessToken: () => session.accessToken,
      getPinToken: () => pin,
      maxAttempts: 1,
    });
    if (role) {
      const configured = await raw(
        '/__control/f5/actor',
        { role, propertyIds },
        session.accessToken,
      );
      expect(configured.status).toBe(200);
    }
    return {
      ...session,
      name,
      client,
      bookings: createBookingApi(client),
      payments: createPaymentApi(client),
      refunds: createRefundApi(client),
      async verify(bookingId: string) {
        const verified = await raw(
          '/auth/pin/verify',
          { pin: '123456', bookingId },
          session.accessToken,
        );
        expect(verified.status).toBe(200);
        pin = pinTokenSchema.parse(await verified.json()).pinToken;
        return pin;
      },
    };
  }
  async function booking(
    owner: Awaited<ReturnType<typeof actor>>,
    propertyId = 'journey-standard',
    ratePlanCode: typeof quoteInput.ratePlanCode = 'FLEX7',
    channelCode: BookingCreateRequest['channelCode'] = 'WEB',
  ): Promise<BookingSummary> {
    const quote = (
      await createQuoteApi(owner.client).quote({
        ...quoteInput,
        propertyId,
        ratePlanCode,
        channelCode,
      })
    ).data;
    return (
      await owner.bookings.create({
        ...bookingInput,
        propertyId,
        ratePlanCode,
        channelCode,
        quoteId: quote.quoteId,
      })
    ).data;
  }
  async function control(
    owner: Awaited<ReturnType<typeof actor>>,
    bookingId: string,
    event: string,
    paymentId?: string,
  ) {
    const response = await raw(
      `/__control/f5/bookings/${bookingId}`,
      { event, ...(paymentId ? { paymentId } : {}) },
      owner.accessToken,
    );
    expect(response.status).toBe(200);
    const value: unknown = await response.json();
    return value;
  }
  return { raw, actor, booking, control, origin, url: () => running.url };
}
export const online = (bookingId: string, amount = 300000) => ({
  bookingId,
  type: 'DEPOSIT' as const,
  method: 'VNPAY' as const,
  amount,
  returnUrl: 'http://127.0.0.1/return',
});
