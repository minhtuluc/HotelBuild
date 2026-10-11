import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { changeApiFrom, validateStay } from '../src/booking-changes/api';
import { bookingSummarySchema } from '@pinehill/contracts';
import { loadChange } from '../src/booking-changes/load';
import { memoryStorage } from '../src/storage';

const row = {
  id: 'b1',
  code: 'PH-test',
  seq: 1,
  status: 'CONFIRMED',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'uuid-plan',
  channelId: 'uuid-channel',
  ratePlanCode: 'FLEX7',
  channelCode: 'WEB',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 2000000,
  depositPercent: 30,
  depositAmount: 600000,
  paidAmount: 600000,
  refundedAmount: 0,
  balanceDue: 1400000,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'g1',
  createdAt: '2026-12-01T00:00:00Z',
  version: 4,
};
const quote = {
  quoteId: 'q1',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-25',
  checkOut: '2026-12-27',
  nights: [],
  subtotal: 1900001,
  discountAmount: 0,
  total: 1900001,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 570001,
  engineVersion: 'v1',
  quotedAt: '2026-10-12T00:00:00Z',
  expiresAt: '2026-10-12T00:05:00Z',
};
const cancellation = {
  bookingId: 'b1',
  currency: 'VND',
  cancellation: {
    policyId: 'p1',
    appliedTierId: 't1',
    hoursBeforeCheckIn: 180,
    refundPercent: 100,
    paidAmount: 600001,
    requestedAmount: 600000,
    penaltyAmount: 0,
    refundFee: 1000,
  },
};
const draft = {
  reason: 'GUEST_REQUEST' as const,
  note: '',
  evidenceRefs: [],
  checkIn: '2026-12-25',
  checkOut: '2026-12-27',
};
let server: Server, client: ApiClient;
let omitEtag = false;
const requests: {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      let body = '';
      for await (const part of req) body += String(part);
      const path = req.url ?? '';
      requests.push({ path, headers: req.headers, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (!omitEtag) res.setHeader('ETag', '"4"');
      const data = path.startsWith('/api/v1/bookings?')
        ? { data: [row], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } }
        : path === '/api/v1/quotes'
          ? quote
          : path.endsWith('cancel-preview')
            ? cancellation
            : path.endsWith('/cancel')
              ? {
                  ...cancellation,
                  status: 'CANCELLED',
                  cancelledAt: '2026-10-12T00:00:00Z',
                  cancelReason: 'GUEST_REQUEST',
                  releasedAssignmentCount: 1,
                  refundRequest: null,
                }
              : row;
      res.end(JSON.stringify(data));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port');
  client = new ApiClient({
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    getAccessToken: () => 'synthetic-access',
    maxAttempts: 1,
  });
});
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});
describe('HB-114 screen loading boundary', () => {
  const deps = () => ({
    session: { silentRefresh: async () => true, apiClient: () => client },
    net: { getConnected: async () => true },
    storage: memoryStorage(),
    createId: () => '11111111-1111-4111-8111-111111111111',
    now: () => 1000,
  });
  it('resolves code from owned list then GET detail and preserves server projection/ETag', async () => {
    const loaded = await loadChange(deps(), row.code, 'cancel');
    expect(loaded.booking.id).toBe(row.id);
    expect(loaded.booking.ratePlanCode).toBe('FLEX7');
    expect(loaded.controller.state.phase).toBe('editing');
    await loaded.controller.preview();
    await loaded.controller.confirm();
    expect(requests.at(-1)?.headers['if-match']).toBe('"4"');
  });
  it('offline or missing session performs no list/command calls', async () => {
    const count = requests.length;
    await expect(
      loadChange({ ...deps(), net: { getConnected: async () => false } }, row.code, 'cancel'),
    ).rejects.toThrow();
    await expect(
      loadChange(
        { ...deps(), session: { silentRefresh: async () => false, apiClient: () => client } },
        row.code,
        'cancel',
      ),
    ).rejects.toThrow();
    expect(requests).toHaveLength(count);
  });
  it('missing detail ETag blocks mutation instead of making up a version', async () => {
    omitEtag = true;
    try {
      await expect(loadChange(deps(), row.code, 'cancel')).rejects.toMatchObject({ status: 428 });
    } finally {
      omitEtag = false;
    }
  });
});
describe('HB-114 published contracts over real TCP', () => {
  it('guest FORCE_MAJEURE is not an offered operation, preview and commit reject before sending', async () => {
    const api = changeApiFrom(client, bookingSummarySchema.parse(row), 'cancel');
    const count = requests.length;
    await expect(api.preview({ ...draft, reason: 'FORCE_MAJEURE' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      api.commit({
        kind: 'cancel',
        bookingId: 'b1',
        etag: '"4"',
        key: '11111111-1111-4111-8111-111111111111',
        createdAt: 1000,
        body: { reason: 'FORCE_MAJEURE', isForceMajeure: true },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(requests).toHaveLength(count);
  });
  it('cancel preview decodes raw server numbers, whole-booking cancellation only', async () => {
    const api = changeApiFrom(client, bookingSummarySchema.parse(row), 'cancel');
    const result = await api.preview(draft);
    expect(result).toMatchObject({ kind: 'cancel', data: cancellation });
    expect(requests.at(-1)?.body).toEqual({ reason: 'GUEST_REQUEST', isForceMajeure: false });
  });
  it('commit carries current session bearer, exact explicit key and IfMatch; replay stable', async () => {
    const api = changeApiFrom(client, bookingSummarySchema.parse(row), 'cancel');
    const intent = {
      kind: 'cancel' as const,
      bookingId: 'b1',
      etag: '"4"',
      key: '11111111-1111-4111-8111-111111111111',
      createdAt: 1000,
      body: { reason: 'GUEST_REQUEST' as const, isForceMajeure: false },
    };
    await api.commit(intent);
    await api.commit(intent);
    const sent = requests.slice(-2);
    expect(sent[0]?.headers.authorization).toBe('Bearer synthetic-access');
    expect(sent[0]?.headers['if-match']).toBe('"4"');
    expect(sent[0]?.headers['idempotency-key']).toBe(intent.key);
    expect(sent[0]?.body).toEqual(sent[1]?.body);
    expect(sent[1]?.headers['idempotency-key']).toBe(intent.key);
  });
  it('reschedule quote uses explicit codes, never guesses UUID plan/channel or computes fees', async () => {
    const api = changeApiFrom(client, bookingSummarySchema.parse(row), 'reschedule');
    expect(await api.preview(draft)).toMatchObject({ kind: 'reschedule', data: quote });
    expect(requests.at(-1)?.body).toMatchObject({
      ratePlanCode: 'FLEX7',
      channelCode: 'WEB',
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
    });
  });
  it('missing projection codes blocks quote without sending default WEB/FLEX7', async () => {
    const without = { ...row, ratePlanCode: undefined, channelCode: undefined };
    const count = requests.length;
    await expect(
      changeApiFrom(client, bookingSummarySchema.parse(without), 'reschedule').preview(draft),
    ).rejects.toThrow();
    expect(requests).toHaveLength(count);
  });
  it('reschedule mutation includes accepted quoteId and identical dates', async () => {
    const api = changeApiFrom(client, bookingSummarySchema.parse(row), 'reschedule');
    await api.commit({
      kind: 'reschedule',
      bookingId: 'b1',
      etag: '"4"',
      key: '11111111-1111-4111-8111-111111111111',
      createdAt: 1000,
      body: { checkIn: draft.checkIn, checkOut: draft.checkOut, quoteId: 'q1' },
    });
    expect(requests.at(-1)?.path).toBe('/api/v1/bookings/b1/reschedule');
    expect(requests.at(-1)?.body).toEqual({
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      quoteId: 'q1',
    });
  });
  it('rejects impossible civil dates, reversed dates and unchanged stays', () => {
    expect(validateStay('2026-02-30', '2026-03-03', bookingSummarySchema.parse(row))).toBe(false);
    expect(validateStay('2026-12-27', '2026-12-26', bookingSummarySchema.parse(row))).toBe(false);
    expect(validateStay(row.checkIn, row.checkOut, bookingSummarySchema.parse(row))).toBe(false);
    expect(validateStay(draft.checkIn, draft.checkOut, bookingSummarySchema.parse(row))).toBe(true);
  });
});
