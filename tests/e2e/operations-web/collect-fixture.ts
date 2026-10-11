import { randomInt, randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  tokenPairSchema,
  quoteSchema,
  bookingSummarySchema,
} from '../../../packages/contracts/src/index.js';
import { quoteInput, bookingInput } from '../../../packages/web-session/test/journey-fixtures.js';

export const fixtureOrigin = new URL(process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1')
  .origin;

/** Seed guest qua HTTP, rồi mở phiên staff qua BFF thật; không page.route thay PIN/payments. */
export async function seedCollection(page: Page, request: APIRequestContext) {
  const phone = `+84${String(randomInt(1_000_000_000)).padStart(9, '0')}`;
  const response = await request.post(`${fixtureOrigin}/api/v1/guest-auth/login`, {
    data: { phone, password: 'Synthetic-password' },
  });
  if (!response.ok()) throw new Error(`Guest fixture login: ${response.status()}`);
  const tokens = tokenPairSchema.parse(await response.json());
  const headers = {
    authorization: `Bearer ${tokens.accessToken}`,
    'idempotency-key': randomUUID(),
  };
  const input = { ...quoteInput, propertyId: 'journey-standard' };
  const quoted = await request.post(`${fixtureOrigin}/api/v1/quotes`, { headers, data: input });
  if (!quoted.ok()) throw new Error(`Quote fixture: ${quoted.status()}`);
  const quote = quoteSchema.parse(await quoted.json());
  const booked = await request.post(`${fixtureOrigin}/api/v1/bookings`, {
    headers: { ...headers, 'idempotency-key': randomUUID() },
    data: { ...bookingInput, propertyId: input.propertyId, quoteId: quote.quoteId },
  });
  if (!booked.ok()) throw new Error(`Booking fixture: ${booked.status()}`);
  const booking = bookingSummarySchema.parse(await booked.json());
  await loginCollectionStaff(page);
  return { booking };
}

/** Phiên staff thật, dùng cả trong các ca lỗi HTTP có chủ đích. */
export async function loginCollectionStaff(page: Page): Promise<void> {
  await page.goto('/');
  const staffToken = await page.evaluate(
    async ({ origin, username }) => {
      const module: typeof import('../../../packages/web-session/src/client.js') = await import(
        origin + '/__test/session-client.js'
      );
      window.sessionClient = module.createSessionClient({ kind: 'staff' });
      await window.sessionClient.login({ username, password: 'Synthetic-password' });
      return window.sessionClient.getAccessToken();
    },
    { origin: fixtureOrigin, username: `synthetic-collector-${randomUUID()}` },
  );
  if (!staffToken) throw new Error('Staff fixture session missing');
}

/** Đăng xuất từ tab khác bằng BFF + coordinator thật, không tự phát event. */
export async function logoutCollectionStaff(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (origin) => {
    const module: typeof import('../../../packages/web-session/src/client.js') = await import(
      origin + '/__test/session-client.js'
    );
    const client = module.createSessionClient({ kind: 'staff' });
    try {
      await client.logout();
    } finally {
      client.dispose();
    }
  }, fixtureOrigin);
}
