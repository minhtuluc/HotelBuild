/**
 * HB-271: `POST /bookings/{id}/cancel` bắt buộc `If-Match` = ETag của `cancel-preview` (HB-097, thiếu thì 428).
 * Lớp API của web khách phải trả ETag của lần xem trước và gửi lại đúng neo đó khi huỷ.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { JourneySession } from '@pinehill/web-session/client';
import { cancelBooking, fetchCancelPreview } from '../../src/app/(guest)/bookings/api';

const preview = {
  bookingId: 'b1',
  currency: 'VND',
  cancellation: {
    policyId: 'p1',
    appliedTierId: 't1',
    hoursBeforeCheckIn: 740,
    refundPercent: 100,
    paidAmount: 390000,
    requestedAmount: 390000,
    penaltyAmount: 0,
    refundFee: 0,
  },
};

const calls: { url: string; headers: Headers }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('window', { location: { origin: 'http://web.test' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      return url.endsWith('/cancel-preview')
        ? Response.json(preview, { status: 200, headers: { etag: 'W/"anchor-7"' } })
        : Response.json({ ignored: true }, { status: 500 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const session: JourneySession = {
  getAccessToken: () => 'token',
  onUnauthorized: async () => false,
};

test('preview returns the server ETag next to the numbers', async () => {
  const read = await fetchCancelPreview(session, 'b1', {
    reason: 'GUEST_REQUEST',
    isForceMajeure: false,
  });
  expect(read.tag).toBe('W/"anchor-7"');
  expect(read.preview).toMatchObject({ bookingId: 'b1' });
});

test('cancel sends If-Match with the anchor of the preview', async () => {
  await cancelBooking(
    session,
    'b1',
    { reason: 'GUEST_REQUEST', isForceMajeure: false },
    'W/"anchor-7"',
  ).catch(() => undefined);
  const sent = calls.find((call) => call.url.endsWith('/cancel'));
  expect(sent?.headers.get('if-match')).toBe('W/"anchor-7"');
});
