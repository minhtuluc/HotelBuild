import type { BookingSummary } from '@pinehill/contracts';
import { Session } from '../src/session';
import { memoryStorage } from '../src/storage';

const tokens = {
  tokenType: 'Bearer',
  accessToken: 'synthetic-access-aaaaaaaaaaaaaaaaaaaa',
  expiresInSeconds: 900,
  refreshToken: 'synthetic-refresh-bbbbbbbbbbbbbbbbbbb',
  refreshExpiresInSeconds: 604800,
};
export const PIN_TOKEN = 'pin-token-0123456789-abc';
export const stay = (id: string, over: Partial<BookingSummary> = {}): BookingSummary => ({
  id,
  code: `PH-261020-${id.toUpperCase()}`,
  seq: 1,
  status: 'CHECKED_IN',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  channelId: 'ch1',
  checkIn: '2026-10-20',
  checkOut: '2026-10-22',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 3_000_000,
  depositPercent: 30,
  depositAmount: 900_000,
  paidAmount: 3_000_000,
  refundedAmount: 0,
  balanceDue: 0,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
export const meta = { limit: 100, total: 1, hasMore: false, nextCursor: null };
export const apiError = (status: number, code: string, message: string, extra = {}) =>
  Response.json(
    { code, message, traceId: 't', timestamp: '2026-10-22T07:00:00Z', path: '/x', ...extra },
    { status },
  );

export interface Post {
  path: string;
  key: string | null;
  body: Record<string, unknown>;
}
export interface Wire {
  online: boolean;
  bookings: unknown[];
  balanceDue: number[];
  verify: () => Response;
  checkOut: (n: number) => Response;
  payment: (n: number) => Response;
  posts: Post[];
  verifies: Array<Record<string, unknown>>;
  balanceReads: number;
}

export const done = () =>
  Response.json({
    bookingId: 'b1',
    status: 'CHECKED_OUT',
    checkedOutAt: '2026-10-22T05:30:00.000Z',
    extrasAmount: 0,
    feeAmount: 150_000,
    balanceDue: 0,
    housekeepingTaskIds: ['t1'],
  });
export const paid = () =>
  Response.json(
    {
      paymentId: 'pay1',
      bookingId: 'b1',
      type: 'BALANCE',
      method: 'CASH',
      amount: 150_000,
      status: 'SUCCEEDED',
      providerTxnId: null,
      paymentUrl: null,
      expiresAt: null,
      paidAt: '2026-10-22T05:31:00.000Z',
      createdAt: '2026-10-22T05:31:00.000Z',
    },
    { status: 201 },
  );

export function wire(over: Partial<Wire> = {}): Wire {
  return {
    online: true,
    bookings: [
      stay('b1'),
      stay('late', { checkOut: '2026-10-21' }),
      stay('later', { checkOut: '2026-10-25' }),
    ],
    balanceDue: [150_000],
    verify: () => Response.json({ pinToken: PIN_TOKEN, expiresAt: '2026-10-22T09:00:00.000Z' }),
    checkOut: done,
    payment: paid,
    posts: [],
    verifies: [],
    balanceReads: 0,
    ...over,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  const parsed: unknown = JSON.parse(init.body);
  return isRecord(parsed) ? parsed : {};
}

function balanceResponse(w: Wire): Response {
  const due = w.balanceDue[Math.min(w.balanceReads++, w.balanceDue.length - 1)] ?? 0;
  return Response.json({
    bookingId: 'b1',
    currency: 'VND',
    totalAmount: 3_000_000,
    paidAmount: 3_000_000 - due,
    refundedAmount: 0,
    reservedRefundAmount: 0,
    balanceDue: due,
  });
}

function route(w: Wire, input: RequestInfo | URL, init: RequestInit | undefined): Response {
  const url = new URL(String(input));
  const path = url.pathname.replace('/api/v1', '');
  const body = parseBody(init);
  if (path === '/auth/login' || path === '/auth/refresh') return Response.json(tokens);
  if (path === '/auth/pin/verify') {
    w.verifies.push(body);
    return w.verify();
  }
  if (path.endsWith('/balance')) return balanceResponse(w);
  if (path === '/bookings') return Response.json({ data: w.bookings, meta });
  w.posts.push({ path, key: new Headers(init?.headers).get('idempotency-key'), body });
  const n = w.posts.filter((p) => p.path === path).length;
  return path === '/payments' ? w.payment(n) : w.checkOut(n);
}

/** Phiên thật nối vào máy chủ giả `w` (đăng nhập khi còn mạng, rồi mới áp trạng thái mạng của kịch bản). */
export async function loggedInSession(w: Wire): Promise<Session> {
  const session = new Session({
    storage: memoryStorage(),
    baseUrl: 'https://synthetic.test/api/v1',
    createId: () => '00000000-0000-4000-8000-000000000000',
    netInfo: { getConnected: async () => w.online },
    fetchImpl: async (input, init) => route(w, input, init),
  });
  const startOnline = w.online;
  w.online = true;
  await session.login('synthetic', 'Synthetic-password');
  w.online = startOnline;
  session.selectProperty('p1');
  return session;
}
