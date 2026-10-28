/**
 * HB-185 — fixture dựng trạng thái "sẵn sàng" cho từng màn trước khi quét axe.
 *
 * Nguyên tắc:
 * - Dùng lại đúng API giả mà ca E2E của màn đó đang dùng (`tests/e2e/fake-api/**`,
 *   `tests/e2e/operations-web/*fixture*`) — không phát minh hợp đồng mới.
 * - Mỗi fixture tự đăng nhập (khách/nhân viên) trước khi cài `page.route`, đúng thứ tự mà
 *   `staff-session.ts` mô tả: phiên phải có trước khi màn tự gọi API.
 * - Fixture trả `bookingId` khi tuyến có `{bookingId}` để spec thay vào đường dẫn.
 */
import { randomInt } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { ApiClient, createBookingApi, createQuoteApi } from '../../../packages/api-client/src/index.js';
import type { BookingSummary } from '../../../packages/contracts/src/index.js';
import type { createSessionClient } from '../../../packages/web-session/src/client.js';
import { bookingInput, quoteInput } from '../../../packages/web-session/test/journey-fixtures.js';
import { installUsersApi } from '../fake-api/users/users';
import { installFrontDeskApi } from '../fake-api/f7/front-desk';
import { installCrmApi } from '../fake-api/f8/crm';
import { installNotiApi } from '../fake-api/f8/notifications';
import { installReportApi } from '../fake-api/f8/reports';
import { fixtureOrigin, loginCollectionStaff } from '../operations-web/collect-fixture';
import { fulfillJson, listBody } from '../operations-web/fake-api';
import { loginRefundStaff, seedRefund } from '../operations-web/refund-fixture';
import type { FixtureName } from './screens';

declare global {
  interface Window {
    sessionClient?: ReturnType<typeof createSessionClient>;
  }
}

export interface FixtureContext {
  readonly page: Page;
  readonly request: APIRequestContext;
}

export interface FixtureResult {
  /** Thay cho `{bookingId}` trong đường dẫn của bảng màn hình. */
  readonly bookingId?: string;
  /** Thao tác sau khi mở trang để màn đạt trạng thái có nội dung (ví dụ bấm "Xem báo giá"). */
  readonly settle?: (page: Page) => Promise<void>;
}

/** Đăng nhập khách bằng SĐT tổng hợp qua session client của BFF (giống các spec SCR-0x). */
async function loginGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (url) => {
    const module: { createSessionClient: typeof createSessionClient } = await import(url);
    window.sessionClient = module.createSessionClient({ kind: 'guest' });
  }, `${fixtureOrigin}/__test/session-client.js`);
  await page.evaluate(
    (phone) => window.sessionClient?.login({ phone, password: 'Synthetic-password' }),
    `+84${String(randomInt(1_000_000_000)).padStart(9, '0')}`,
  );
}

/** Nhân viên thật qua BFF + vai OWNER (đủ quyền cho mọi màn vận hành cần quét). */
async function loginOps(page: Page, request: APIRequestContext): Promise<void> {
  await loginRefundStaff(page, request, 'OWNER');
}

/** Booking thật trên API giả hành trình (HB-116), cùng đường đi với `scr06`/`scr12`. */
async function createGuestBooking(page: Page): Promise<string> {
  await loginGuest(page);
  const token = (): Promise<string | null> =>
    page.evaluate(async () => (await window.sessionClient?.getAccessToken()) ?? null);
  const client = new ApiClient({
    baseUrl: `${fixtureOrigin}/api/v1`,
    getAccessToken: async () => (await token()) ?? '',
    maxAttempts: 1,
  });
  const quote = (await createQuoteApi(client).quote({ ...quoteInput, ratePlanCode: 'SAVER3' })).data;
  const booking = (
    await createBookingApi(client).create({
      ...bookingInput,
      ratePlanCode: 'SAVER3',
      quoteId: quote.quoteId,
    })
  ).data;
  return booking.id;
}

/** Sự kiện giả HB-116: có khoản thu một phần chưa xác nhận để màn huỷ tính được hoàn tiền. */
async function injectPartialPayment(page: Page, bookingId: string): Promise<void> {
  const status = await page.evaluate(
    async ({ url, bookingId: id }) => {
      const accessToken = await window.sessionClient?.getAccessToken();
      const response = await fetch(`${url}/__control/f5/bookings/${id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken === null || accessToken === undefined
            ? {}
            : { authorization: `Bearer ${accessToken}` }),
        },
        body: JSON.stringify({ event: 'unconfirmed-partial' }),
      });
      return response.status;
    },
    { url: fixtureOrigin, bookingId },
  );
  expect(status).toBe(200);
}

/** Bản ghi `BookingSummary` tổng hợp cho API danh sách HB-116 chưa có (`scr09`). */
function bookingRow(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: 'bk-1',
    code: 'SYN079',
    seq: 1,
    status: 'HELD',
    guestId: 'guest-1',
    propertyId: 'synthetic-property',
    roomTypeId: 'synthetic-room',
    ratePlanId: 'FLEX7',
    channelId: 'web',
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    nights: 2,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: 2_000_000,
    depositPercent: 30,
    depositAmount: 600_000,
    paidAmount: 0,
    refundedAmount: 0,
    balanceDue: 2_000_000,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'guest-1',
    createdAt: '2026-12-23T02:00:00.000Z',
    ...overrides,
  };
}

const GUEST = {
  id: 'g1',
  fullName: 'Nguyễn Văn An',
  phone: '+84912345678',
  email: 'an@example.com',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 1200,
  totalStays: 7,
  blacklisted: false,
  consentMarketing: true,
  createdAt: '2026-09-19T03:14:02.000Z',
};

const LOYALTY = {
  guestId: 'g1',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 1200,
  staysLast12Months: 3,
  totalStays: 7,
  updatedAt: '2026-10-01T00:00:00.000Z',
};

// ── Dữ liệu API giả cho các màn vận hành (sao đúng hình dạng từ spec của màn) ────────────────────

const PROPERTY = {
  id: 'p1',
  name: 'Pine Hill Đà Lạt',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 3,
};

const ROOM_TYPE = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'DLX',
  capacityAdults: 2,
  capacityChildren: 1,
  basePrice: 900_000,
  minPrice: 700_000,
  maxPrice: 1_400_000,
  allowShared: false,
  bedCount: 1,
  version: 1,
};

const ROOM_A = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: '101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 2,
};

const AUDIT_ROW = {
  id: 'a1',
  actorId: 'u1',
  action: 'SystemSettingUpdate',
  entityType: 'SystemSetting',
  entityId: 'pricing.maxDiscountPct',
  reason: 'Tăng trần',
  beforeJson: null,
  afterJson: null,
  createdAt: '2026-11-12T07:00:00.000Z',
};

const SETTING = {
  key: 'pricing.maxDiscountPct',
  value: '20',
  valueType: 'NUMBER',
  description: 'Trần giảm giá tối đa',
  updatedBy: 'u1',
  updatedAt: '2026-11-12T07:00:00.000Z',
  version: 4,
};

const CHANNEL = {
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Booking.com',
  multiplier: 1,
  commissionPct: 18,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 4,
};

const PROMOTION = {
  id: 'pr1',
  code: 'EARLY10',
  type: 'PERCENT',
  value: 10,
  minNights: 2,
  channelScope: ['WEB'],
  roomTypeScope: ['rt1'],
  validFrom: '2026-11-01T00:00:00.000Z',
  validTo: '2026-11-30T16:59:00.000Z',
  maxUses: 100,
  usedCount: 3,
  stackable: false,
  status: 'ACTIVE',
  version: 1,
};

const QUOTE = {
  roomTypeId: 'rt1',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  options: [
    {
      channelCode: 'WEB',
      nightlyFrom: 1_421_000,
      totalFrom: 4_263_000,
      commissionPct: 0,
      grossTotal: 8_112_000,
      commissionAmount: 0,
      netTotal: 8_112_000,
      warnings: [],
    },
    {
      channelCode: 'OTA_BOOKING',
      nightlyFrom: 1_776_250,
      totalFrom: 5_328_750,
      commissionPct: 18,
      grossTotal: 5_328_750,
      commissionAmount: 959_175,
      netTotal: 4_369_575,
      warnings: ['Giá thuần thấp hơn WEB'],
    },
  ],
};

const OPS_BOOKING = {
  id: 'b1',
  code: 'PH-2601-00001',
  seq: 1,
  status: 'CONFIRMED',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'FLEX7',
  channelId: 'c1',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: 2,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 2_000_000,
  depositPercent: 30,
  depositAmount: 600_000,
  paidAmount: 600_000,
  refundedAmount: 0,
  balanceDue: 1_400_000,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'staff-1',
  createdAt: '2026-12-01T00:00:00.000Z',
};

const POLICY = {
  id: 'pol-1',
  name: 'Chuẩn',
  status: 'ACTIVE',
  tiers: [
    { hoursBeforeCheckIn: 168, refundPercent: 100, label: 'Trước 7 ngày' },
    { hoursBeforeCheckIn: 96, refundPercent: 100 },
    { hoursBeforeCheckIn: 24, refundPercent: 50 },
  ],
  earlyCheckoutFreeHours: 2,
  earlyCheckoutRefundPct: 100,
  version: 1,
};

const CANCEL_PREVIEW = JSON.stringify({
  bookingId: 'b1',
  currency: 'VND',
  cancellation: {
    policyId: 'pol-1',
    appliedTierId: '72h',
    hoursBeforeCheckIn: 96,
    refundPercent: 100,
    paidAmount: 600_000,
    requestedAmount: 600_000,
    penaltyAmount: 0,
    refundFee: 0,
  },
  warnings: [],
});

function datesBetween(from: string, to: string): readonly string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Array.from({ length: days }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

function gridBody(roomTypeId: string, from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const days = Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) + 1 : 1;
  const cells = Array.from({ length: Math.max(1, days) }, (_, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    supply: 20,
    demand: 14,
    pool: 6,
    blocked: 0,
  }));
  return { propertyId: 'p1', roomTypeId, from, to, cells };
}

async function stubPropertiesAndRoomTypes(page: Page): Promise<void> {
  await page.route('**/api/session/sys/properties**', (route) =>
    fulfillJson(route, 200, listBody([PROPERTY])),
  );
  await page.route('**/api/session/sys/room-types**', (route) =>
    fulfillJson(route, 200, listBody([ROOM_TYPE])),
  );
}

async function stubOpsBookings(page: Page, detail: unknown = OPS_BOOKING): Promise<void> {
  await page.route(/\/api\/session\/sys\/bookings/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    if (url.pathname.endsWith('/bookings')) return fulfillJson(route, 200, listBody([OPS_BOOKING]));
    return fulfillJson(route, 200, JSON.stringify(detail));
  });
}

async function stubCancel(page: Page): Promise<void> {
  await page.route(/\/api\/session\/sys\/cancellation-policies/, (route) =>
    fulfillJson(route, 200, listBody([POLICY])),
  );
  await page.route(/\/api\/session\/sys\/quotes/, (route) =>
    fulfillJson(
      route,
      201,
      JSON.stringify({
        quoteId: 'q-new',
        channelCode: 'WEB',
        ratePlanCode: 'FLEX7',
        checkIn: '2026-12-27',
        checkOut: '2026-12-29',
        nights: [],
        subtotal: 3_000_000,
        discountAmount: 0,
        total: 3_000_000,
        currency: 'VND',
        warnings: [],
        depositPercent: 30,
        depositAmount: 900_000,
        engineVersion: 'v1',
        quotedAt: '2026-12-01T00:00:00.000Z',
        expiresAt: '2026-12-01T00:15:00.000Z',
      }),
    ),
  );
  await page.route(/\/api\/session\/sys\/bookings/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/cancel-preview')) return fulfillJson(route, 200, CANCEL_PREVIEW);
    if (url.pathname.endsWith('/cancel')) {
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          bookingId: 'b1',
          status: 'CANCELLED',
          cancelledAt: '2026-12-02T03:00:00.000Z',
          cancelReason: 'GUEST_REQUEST',
          releasedAssignmentCount: 2,
          cancellation: JSON.parse(CANCEL_PREVIEW).cancellation,
          refundRequest: { id: 'rf-1', status: 'PENDING', approvedAmount: null },
        }),
      );
    }
    if (url.pathname.endsWith('/reschedule')) {
      return fulfillJson(route, 200, JSON.stringify({ ...OPS_BOOKING, rescheduleCount: 1 }));
    }
    return fulfillJson(route, 200, JSON.stringify(OPS_BOOKING));
  });
}

async function stubCollect(page: Page): Promise<void> {
  await page.route('**/api/session/sys/bookings/**', (route) =>
    fulfillJson(route, 200, JSON.stringify(OPS_BOOKING)),
  );
  await page.route(/\/api\/v1\/bookings/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/balance')) {
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          bookingId: 'b1',
          currency: 'VND',
          totalAmount: 2_000_000,
          paidAmount: 0,
          refundedAmount: 0,
          reservedRefundAmount: 0,
          balanceDue: 2_000_000,
        }),
      );
    }
    return fulfillJson(route, 200, JSON.stringify(OPS_BOOKING));
  });
}

// ── Bảng fixture ───────────────────────────────────────────────────────────────────────────────

const FIXTURES: Record<FixtureName, (ctx: FixtureContext) => Promise<FixtureResult>> = {
  'customer-public': async () => ({}),
  'customer-guest': async ({ page }) => {
    await loginGuest(page);
    return {};
  },
  'customer-booking': async ({ page }) => {
    const bookingId = await createGuestBooking(page);
    return { bookingId };
  },
  'customer-booking-paid': async ({ page }) => {
    const bookingId = await createGuestBooking(page);
    await injectPartialPayment(page, bookingId);
    return { bookingId };
  },
  'customer-bookings-list': async ({ page }) => {
    await loginGuest(page);
    await page.route('**/api/session/journey/bookings*', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/bookings')) {
        return fulfillJson(route, 200, listBody([bookingRow()]));
      }
      return route.continue();
    });
    return {};
  },
  'customer-profile': async ({ page }) => {
    await loginGuest(page);
    await page.route('**/api/session/journey/guests/me', (route) =>
      fulfillJson(route, 200, JSON.stringify(GUEST)),
    );
    await page.route('**/api/session/journey/guests/me/loyalty', (route) =>
      fulfillJson(route, 200, JSON.stringify(LOYALTY)),
    );
    return {};
  },
  'ops-anonymous': async () => ({}),
  'ops-users': async ({ page }) => {
    await loginCollectionStaff(page);
    await installUsersApi(page);
    return {};
  },
  'ops-audit': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/audit-logs*', (route) =>
      fulfillJson(route, 200, listBody([AUDIT_ROW])),
    );
    return {};
  },
  'ops-settings': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/system-settings**', (route) =>
      fulfillJson(route, 200, listBody([SETTING])),
    );
    return {};
  },
  'ops-properties': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/properties**', (route) =>
      fulfillJson(route, 200, listBody([PROPERTY])),
    );
    return {};
  },
  'ops-room-types': async ({ page, request }) => {
    await loginOps(page, request);
    await stubPropertiesAndRoomTypes(page);
    return {};
  },
  'ops-rooms': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/rooms?*', (route) =>
      fulfillJson(route, 200, listBody([ROOM_A])),
    );
    await page.route('**/api/session/sys/room-types?*', (route) =>
      fulfillJson(route, 200, listBody([ROOM_TYPE])),
    );
    return {};
  },
  'ops-room-blocks': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/properties?*', (route) =>
      fulfillJson(route, 200, listBody([PROPERTY])),
    );
    await page.route('**/api/session/sys/rooms?*', (route) =>
      fulfillJson(route, 200, listBody([ROOM_A])),
    );
    await page.route('**/api/session/sys/room-blocks**', (route) =>
      fulfillJson(
        route,
        200,
        listBody([
          {
            id: 'bl1',
            roomId: 'r1',
            startDate: '2026-12-20',
            endDate: '2026-12-22',
            reason: 'MAINTENANCE',
            note: 'Thay bóng đèn',
          },
        ]),
      ),
    );
    return {};
  },
  'ops-day-board': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/v1/properties', (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route('**/api/v1/room-types*', (route) =>
      fulfillJson(
        route,
        200,
        listBody([{ ...ROOM_TYPE, code: 'DOR', capacityAdults: 6, bedCount: 6 }]),
      ),
    );
    await page.route('**/api/v1/inventory/grid*', (route) => {
      const url = new URL(route.request().url());
      const date = url.searchParams.get('from') ?? '2026-12-24';
      return fulfillJson(
        route,
        200,
        JSON.stringify({
          propertyId: 'p1',
          roomTypeId: 'rt1',
          from: date,
          to: date,
          capturedAt: '2026-10-12T00:00:00.000Z',
          cells: [{ date, supply: 6, demand: 2, pool: 4, blocked: 0, published: 3 }],
        }),
      );
    });
    return {};
  },
  'ops-inventory-grid': async ({ page, request }) => {
    await loginOps(page, request);
    await stubPropertiesAndRoomTypes(page);
    await page.route('**/api/session/sys/inventory/grid*', (route) => {
      const url = new URL(route.request().url());
      const from = url.searchParams.get('from') ?? '2026-12-24';
      const to = url.searchParams.get('to') ?? '2026-12-26';
      const grids = [gridBody('rt1', from, to)];
      return fulfillJson(route, 200, JSON.stringify({ ...grids[0], grids }));
    });
    return {};
  },
  'ops-allotments': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/properties**', (route) =>
      fulfillJson(route, 200, listBody([PROPERTY])),
    );
    await page.route('**/api/session/sys/room-types**', (route) =>
      fulfillJson(route, 200, listBody([{ ...ROOM_TYPE, sellingUnits: 8 }])),
    );
    await page.route('**/api/session/sys/channels**', (route) =>
      fulfillJson(route, 200, listBody([CHANNEL])),
    );
    await page.route('**/api/session/sys/channel-allotments**', (route) => {
      const url = new URL(route.request().url());
      const from = url.searchParams.get('from') ?? '';
      const to = url.searchParams.get('to') ?? '';
      const rows = datesBetween(from, to).map((date, index) => ({
        date,
        allotment: index % 2 === 0 ? 5 : 6,
        used: index % 2 === 0 ? 2 : 0,
      }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ETag: '"7"', 'Access-Control-Expose-Headers': 'ETag' },
        body: listBody(rows),
      });
    });
    return {};
  },
  'ops-rate-calendar': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route(/\/api\/session\/sys\/properties/, (route) =>
      fulfillJson(route, 200, listBody([PROPERTY])),
    );
    await page.route(/\/api\/session\/sys\/room-types(\?|$)/, (route) =>
      fulfillJson(route, 200, listBody([ROOM_TYPE])),
    );
    await page.route(/\/api\/session\/sys\/room-types\/[^/]+\/rate-calendar/, (route) => {
      const url = new URL(route.request().url());
      const from = url.searchParams.get('from') ?? '2026-12-24';
      const to = url.searchParams.get('to') ?? '2026-12-26';
      const start = Date.parse(`${from}T00:00:00Z`);
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000) + 1;
      const entries = Array.from({ length: Math.max(1, days) }, (_, index) => ({
        date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        basePrice: ROOM_TYPE.basePrice,
        seasonMultiplier: 1,
        weekendMultiplier: 1,
        occupancyMultiplier: 1,
        losMultiplier: 1,
        channelMultiplier: 1,
        clamped: false,
        nightlyPrice: 900_000,
        source: 'BASE',
      }));
      return fulfillJson(
        route,
        200,
        JSON.stringify({ roomTypeId: ROOM_TYPE.id, from, to, entries }),
      );
    });
    return {};
  },
  'ops-seasons': async ({ page, request }) => {
    await loginOps(page, request);
    await stubPropertiesAndRoomTypes(page);
    await page.route('**/api/session/sys/room-types/*/rate-calendar*', (route) =>
      fulfillJson(
        route,
        200,
        JSON.stringify({
          roomTypeId: 'rt1',
          from: '2026-06-01',
          to: '2026-06-02',
          entries: [
            {
              date: '2026-06-01',
              basePrice: 900_000,
              seasonMultiplier: 1.4,
              weekendMultiplier: 1,
              occupancyMultiplier: 1,
              losMultiplier: 1,
              channelMultiplier: 1,
              clamped: false,
              nightlyPrice: 1_260_000,
              source: 'SEASON',
              seasonName: 'Hè 2026',
            },
            {
              date: '2026-06-02',
              basePrice: 900_000,
              seasonMultiplier: 1,
              weekendMultiplier: 1,
              occupancyMultiplier: 1,
              losMultiplier: 1,
              channelMultiplier: 1,
              clamped: false,
              nightlyPrice: 900_000,
              source: 'BASE',
            },
          ],
        }),
      ),
    );
    await page.route('**/api/session/sys/seasons**', (route) =>
      fulfillJson(
        route,
        200,
        listBody([
          {
            id: 's1',
            propertyId: 'p1',
            name: 'Hè 2026',
            startDate: '2026-06-01',
            endDate: '2026-08-31',
            multiplier: 1.4,
            priority: 5,
            weekendSurchargeEnabled: true,
            version: 2,
          },
        ]),
      ),
    );
    return {};
  },
  'ops-channels': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/properties**', (route) =>
      fulfillJson(route, 200, listBody([PROPERTY])),
    );
    await page.route('**/api/session/sys/channels', (route) =>
      fulfillJson(route, 200, listBody([CHANNEL])),
    );
    await page.route('**/api/session/sys/channels/c1', (route) =>
      fulfillJson(route, 200, JSON.stringify({ ...CHANNEL, propertyOverrides: [] })),
    );
    return {};
  },
  'ops-promotions': async ({ page, request }) => {
    await loginOps(page, request);
    await stubPropertiesAndRoomTypes(page);
    await page.route('**/api/session/sys/promotions', (route) =>
      fulfillJson(route, 200, listBody([PROMOTION])),
    );
    return {};
  },
  'ops-multi-channel-quote': async ({ page, request }) => {
    await loginOps(page, request);
    await stubPropertiesAndRoomTypes(page);
    await page.route('**/api/session/sys/quotes/multi-channel', (route) =>
      fulfillJson(route, 200, JSON.stringify(QUOTE)),
    );
    return {
      settle: async (page) => {
        await page.getByLabel('Nhận phòng').fill('2026-12-24');
        await page.getByLabel('Trả phòng').fill('2026-12-27');
        await page.getByRole('button', { name: 'Xem báo giá' }).click();
      },
    };
  },
  'ops-rate-plans': async ({ page, request }) => {
    await loginOps(page, request);
    await page.route('**/api/session/sys/rate-plans**', (route) =>
      fulfillJson(
        route,
        200,
        listBody([
          {
            id: '00000000-0000-4000-8000-000000000001',
            code: 'FLEX7',
            name: 'Synthetic',
            minNights: 1,
            maxNights: 7,
            depositPercent: 30,
            cancellationPolicyId: '00000000-0000-4000-8000-000000000002',
            status: 'ACTIVE',
            version: 3,
          },
        ]),
      ),
    );
    await page.route('**/api/session/sys/cancellation-policies**', (route) =>
      fulfillJson(route, 200, listBody([POLICY])),
    );
    return {};
  },
  'ops-bookings': async ({ page, request }) => {
    await loginOps(page, request);
    await stubOpsBookings(page);
    return {};
  },
  'ops-booking-detail': async ({ page, request }) => {
    await loginOps(page, request);
    await stubOpsBookings(page);
    return {};
  },
  'ops-booking-new': async ({ page, request }) => {
    await loginOps(page, request);
    const channel = (code: string, holdMinutes: number) => ({
      id: `c-${code}`,
      code,
      name: code,
      multiplier: 1,
      commissionPct: 0,
      holdMinutes,
      overbookAllowed: code === 'WALKIN',
      version: 1,
    });
    await page.route(/\/api\/session\/sys\/channels/, (route) =>
      fulfillJson(route, 200, listBody([channel('WALKIN', 30), channel('PHONE', 1440)])),
    );
    await page.route(/\/api\/session\/sys\/inventory\/availability/, (route) =>
      fulfillJson(
        route,
        200,
        JSON.stringify({
          checkIn: '2026-12-24',
          checkOut: '2026-12-26',
          nights: 2,
          data: [
            {
              propertyId: 'p1',
              roomTypeId: 'rt1',
              roomTypeCode: 'STD',
              roomTypeName: 'Phòng tiêu chuẩn',
              capacityAdults: 2,
              availableCount: 3,
              soldOut: false,
              minNights: 1,
              maxNights: 365,
              nightlyFrom: 1_000_000,
              totalFrom: 2_000_000,
            },
          ],
          meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
        }),
      ),
    );
    await page.route(/\/api\/session\/sys\/rate-plans/, (route) =>
      fulfillJson(
        route,
        200,
        listBody([
          { code: 'FLEX7', name: 'Linh hoạt 7 ngày', minNights: 1, maxNights: 365, depositPercent: 30 },
        ]),
      ),
    );
    await page.route(/\/api\/session\/sys\/quotes/, (route) =>
      fulfillJson(
        route,
        201,
        JSON.stringify({
          quoteId: 'q1',
          channelCode: 'WALKIN',
          ratePlanCode: 'FLEX7',
          checkIn: '2026-12-24',
          checkOut: '2026-12-26',
          nights: [],
          subtotal: 2_000_000,
          discountAmount: 0,
          total: 2_000_000,
          currency: 'VND',
          warnings: [],
          depositPercent: 30,
          depositAmount: 600_000,
          engineVersion: 'v1',
          quotedAt: '2026-12-01T00:00:00.000Z',
          expiresAt: '2026-12-01T00:15:00.000Z',
        }),
      ),
    );
    await page.route(/\/api\/session\/sys\/guests/, (route) =>
      fulfillJson(route, 200, listBody([GUEST])),
    );
    await page.route(/\/api\/session\/sys\/bookings/, (route) =>
      fulfillJson(route, 200, listBody([])),
    );
    return {};
  },
  'ops-booking-reschedule': async ({ page, request }) => {
    await loginOps(page, request);
    await stubCancel(page);
    return {};
  },
  'ops-booking-cancel': async ({ page, request }) => {
    await loginOps(page, request);
    await stubCancel(page);
    return {};
  },
  'ops-collect': async ({ page, request }) => {
    await loginOps(page, request);
    await stubCollect(page);
    return {};
  },
  'ops-refunds': async ({ page, request }) => {
    const { booking } = await seedRefund(page, request);
    return { bookingId: booking.id };
  },
  'ops-front-desk': async ({ page, request }) => {
    await loginOps(page, request);
    await installFrontDeskApi(page, { businessDate: '2026-12-24' });
    return {};
  },
  'ops-crm-guests': async ({ page, request }) => {
    await loginOps(page, request);
    installCrmApi(page);
    return {};
  },
  'ops-crm-loyalty': async ({ page, request }) => {
    await loginOps(page, request);
    installCrmApi(page);
    return {};
  },
  'ops-noti': async ({ page, request }) => {
    await loginOps(page, request);
    installNotiApi(page);
    return {};
  },
  'ops-reports': async ({ page, request }) => {
    await loginOps(page, request);
    installReportApi(page);
    return {};
  },
};

/**
 * Cài fixture của màn; trả `bookingId` khi tuyến cần id booking tổng hợp.
 * Fixture `undefined` coi như không cần dựng gì (chỉ màn công khai).
 */
export async function installFixture(
  name: FixtureName | undefined,
  context: FixtureContext,
): Promise<FixtureResult> {
  if (name === undefined) return {};
  return FIXTURES[name](context);
}

/** Đường dẫn đã thay `{bookingId}`; giữ nguyên khi màn không có placeholder. */
export function resolvePath(path: string, result: FixtureResult): string {
  if (!path.includes('{bookingId}')) return path;
  if (result.bookingId === undefined) throw new Error(`Màn cần bookingId nhưng fixture không trả: ${path}`);
  return path.replace('{bookingId}', encodeURIComponent(result.bookingId));
}
