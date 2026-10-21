/**
 * API giả F7 — bàn tiền sảnh SCR-48 (HB-152).
 *
 * Dùng `page.route` giống F8: server HTTP dùng chung không biết plugin này, nên không sửa `server.ts`.
 * Route chỉ chặn `/api/v1/**`; phiên nhân viên vẫn đi qua BFF thật của app.
 *
 * Hình dạng trả về bám đúng `checkInResponseSchema`, `checkOutResponseSchema`, `noShowResponseSchema`,
 * `walkInResultSchema`, `paymentSchema` để client thật parse được. Mã lỗi bám api.md §4
 * (`E_FO_CHECKIN_NOT_ALLOWED`, `E_AUTH_PIN_REQUIRED`).
 */
import type { Page, Route } from '@playwright/test';

export interface FrontDeskApiOptions {
  /** Ngày nghiệp vụ của fixture; màn hình nhận cùng ngày qua `?date=` để kiểm tất định. */
  businessDate: string;
  /** `blocked` trả 409 đúng mã nghiệp vụ; mặc định thành công. */
  checkIn?: 'ok' | 'blocked';
  checkOutFee?: number;
  noShowPenalty?: number;
  /** Trả danh sách booking rỗng để kiểm trạng thái empty. */
  empty?: boolean;
  /** Ép lỗi đọc ở `GET /properties` (ví dụ 403) để kiểm trạng thái thiếu quyền. */
  propertiesStatus?: number;
}

export interface FrontDeskSpy {
  readonly checkIns: string[];
  readonly checkOuts: string[];
  readonly noShows: string[];
  readonly walkIns: string[];
  readonly payments: string[];
  readonly pinVerifies: string[];
  readonly urls: string[];
}

const PROPERTY = {
  id: 'p1',
  name: 'Pine Hill synthetic',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 1,
};

const ROOM_TYPE = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'DOR',
  capacityAdults: 4,
  capacityChildren: 0,
  basePrice: 1_000_000,
  minPrice: 800_000,
  maxPrice: 2_000_000,
  allowShared: false,
  bedCount: 1,
  version: 1,
};

const ROOMS = [
  {
    id: 'r1',
    propertyId: 'p1',
    roomTypeId: 'rt1',
    code: '201',
    floor: 2,
    status: 'ACTIVE',
    connectingRoomId: null,
    version: 1,
  },
  {
    id: 'r2',
    propertyId: 'p1',
    roomTypeId: 'rt1',
    code: '202',
    floor: 2,
    status: 'ACTIVE',
    connectingRoomId: null,
    version: 1,
  },
];

function booking(
  id: string,
  code: string,
  status: string,
  checkIn: string,
  checkOut: string,
  balanceDue: number,
) {
  return {
    id,
    code,
    seq: 1,
    status,
    guestId: `g-${id}`,
    propertyId: 'p1',
    roomTypeId: 'rt1',
    ratePlanId: 'FLEX7',
    channelId: 'c1',
    checkIn,
    checkOut,
    nights: 2,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: 2_000_000,
    depositPercent: 30,
    depositAmount: 600_000,
    paidAmount: 600_000,
    refundedAmount: 0,
    balanceDue,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: null,
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: `g-${id}`,
    createdAt: '2026-12-01T00:00:00.000Z',
  };
}

function listBody(rows: readonly unknown[]): string {
  return JSON.stringify({
    data: rows,
    meta: { limit: 100, nextCursor: null, hasMore: false, total: rows.length },
  });
}

function errorBody(code: string, message: string, path: string): string {
  return JSON.stringify({
    code,
    message,
    traceId: 'trace-f7-synthetic',
    timestamp: '2026-12-24T03:00:00.000Z',
    path,
  });
}

async function json(route: Route, status: number, body: string): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body });
}

function record(bucket: string[], route: Route): void {
  bucket.push(route.request().postData() ?? '');
}

export async function installFrontDeskApi(
  page: Page,
  options: FrontDeskApiOptions,
): Promise<FrontDeskSpy> {
  const spy: FrontDeskSpy = {
    checkIns: [],
    checkOuts: [],
    noShows: [],
    walkIns: [],
    payments: [],
    pinVerifies: [],
    urls: [],
  };
  const arrival = booking(
    'b1',
    'PH-261224-AAAAA',
    'CONFIRMED',
    options.businessDate,
    '2026-12-26',
    1_400_000,
  );
  const inHouse = booking(
    'b2',
    'PH-261222-BBBBB',
    'CHECKED_IN',
    '2026-12-22',
    '2026-12-27',
    0,
  );
  const departure = booking(
    'b3',
    'PH-261220-CCCCC',
    'CHECKED_IN',
    '2026-12-20',
    options.businessDate,
    0,
  );

  await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      spy.urls.push(request.url());
      if (request.method() === 'GET' && path === '/api/v1/properties') {
        if (options.propertiesStatus !== undefined) {
          await json(
            route,
            options.propertiesStatus,
            errorBody('E_RBAC_FORBIDDEN', 'Không có quyền', path),
          );
          return;
        }
        await json(route, 200, listBody([PROPERTY]));
        return;
      }
      if (request.method() === 'GET' && path === '/api/v1/room-types') {
        await json(route, 200, listBody([ROOM_TYPE]));
        return;
      }
      if (request.method() === 'GET' && path === '/api/v1/rooms') {
        await json(route, 200, listBody(ROOMS));
        return;
      }
      if (request.method() === 'GET' && path === '/api/v1/bookings') {
        if (options.empty === true) {
          await json(route, 200, listBody([]));
          return;
        }
        const rows =
          url.searchParams.get('status') === 'CHECKED_IN' ? [inHouse, departure] : [arrival];
        await json(route, 200, listBody(rows));
        return;
      }
      if (request.method() === 'POST' && path === '/api/v1/auth/pin/verify') {
        record(spy.pinVerifies, route);
        await json(
          route,
          200,
          JSON.stringify({
            pinToken: 'synthetic-pin-token-1234567890',
            expiresAt: '2099-12-24T03:05:00.000Z',
          }),
        );
        return;
      }
      if (request.method() === 'POST' && path === '/api/v1/front-office/check-in') {
        record(spy.checkIns, route);
        if (options.checkIn === 'blocked') {
          await json(
            route,
            409,
            errorBody(
              'E_FO_CHECKIN_NOT_ALLOWED',
              'Công nợ vượt ngưỡng hoặc phòng chưa sẵn sàng',
              path,
            ),
          );
          return;
        }
        const body = request.postDataJSON() as {
          bookingId?: string;
          actualRoomIds?: string[];
          earlyCheckIn?: boolean;
        };
        await json(
          route,
          200,
          JSON.stringify({
            bookingId: body.bookingId ?? 'b1',
            status: 'CHECKED_IN',
            roomIds: body.actualRoomIds ?? ['r1'],
            checkedInAt: '2026-12-24T03:00:00.000Z',
            earlyCheckInFee: body.earlyCheckIn === true ? 300_000 : 0,
          }),
        );
        return;
      }
      if (request.method() === 'POST' && path === '/api/v1/front-office/check-out') {
        record(spy.checkOuts, route);
        const body = request.postDataJSON() as { bookingId?: string; pinToken?: string };
        if (body.pinToken === undefined) {
          await json(route, 401, errorBody('E_AUTH_PIN_REQUIRED', 'Cần PIN', path));
          return;
        }
        await json(
          route,
          200,
          JSON.stringify({
            bookingId: body.bookingId ?? 'b3',
            status: 'CHECKED_OUT',
            checkedOutAt: '2026-12-24T05:00:00.000Z',
            extrasAmount: 0,
            feeAmount: options.checkOutFee ?? 150_000,
            balanceDue: 0,
            housekeepingTaskIds: ['hk-1'],
          }),
        );
        return;
      }
      if (request.method() === 'POST' && path === '/api/v1/front-office/no-show') {
        record(spy.noShows, route);
        const body = request.postDataJSON() as { bookingId?: string };
        await json(
          route,
          200,
          JSON.stringify({
            bookingId: body.bookingId ?? 'b1',
            status: 'NO_SHOW',
            markedAt: '2026-12-24T16:59:00.000Z',
            penaltyAmount: options.noShowPenalty ?? 1_000_000,
            refundRequestId: null,
          }),
        );
        return;
      }
      if (request.method() === 'POST' && path === '/api/v1/walk-in') {
        record(spy.walkIns, route);
        const body = request.postDataJSON() as {
          propertyId?: string;
          roomTypeId?: string;
          ratePlanCode?: string;
          checkIn?: string;
          checkOut?: string;
          adults?: number;
          children?: number;
          roomCount?: number;
        };
        const checkIn = body.checkIn ?? options.businessDate;
        const checkOut = body.checkOut ?? '2026-12-25';
        const nights = Math.max(
          1,
          Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000),
        );
        await json(
          route,
          201,
          JSON.stringify({
            created: true,
            quote: {
              quoteId: 'q-walkin-1',
              channelCode: 'WALKIN',
              ratePlanCode: body.ratePlanCode ?? 'FLEX7',
              checkIn,
              checkOut,
              nights: Array.from({ length: nights }, () => ({
                date: checkIn,
                basePrice: 1_000_000,
                seasonMultiplier: 1,
                weekendMultiplier: 1,
                occupancyMultiplier: 1,
                losMultiplier: 1,
                channelMultiplier: 1,
                clamped: false,
                nightlyPrice: 1_000_000,
              })),
              subtotal: 1_000_000 * nights,
              discountAmount: 0,
              total: 1_000_000 * nights,
              currency: 'VND',
              warnings: [],
              depositPercent: 30,
              depositAmount: 300_000 * nights,
              engineVersion: 'synthetic',
              quotedAt: '2026-12-24T03:00:00.000Z',
              expiresAt: '2099-12-24T03:15:00.000Z',
            },
            booking: {
              ...arrival,
              id: 'b-walkin',
              code: 'PH-261224-WLKIN',
              status: 'CONFIRMED',
              guestId: 'g-walkin',
              propertyId: body.propertyId ?? 'p1',
              roomTypeId: body.roomTypeId ?? 'rt1',
              ratePlanId: body.ratePlanCode ?? 'FLEX7',
              channelId: 'c-walkin',
              checkIn,
              checkOut,
              nights,
              adults: body.adults ?? 2,
              children: body.children ?? 0,
              roomCount: body.roomCount ?? 1,
              totalAmount: 1_000_000 * nights,
              depositAmount: 300_000 * nights,
              paidAmount: 0,
              balanceDue: 1_000_000 * nights,
              createdBy: 'g-walkin',
            },
          }),
        );
        return;
      }
      if (request.method() === 'POST' && path === '/api/v1/payments') {
        record(spy.payments, route);
        const body = request.postDataJSON() as {
          bookingId?: string;
          type?: string;
          method?: string;
          amount?: number;
          pinToken?: string;
        };
        if (body.pinToken === undefined) {
          await json(route, 401, errorBody('E_AUTH_PIN_REQUIRED', 'Cần PIN', path));
          return;
        }
        await json(
          route,
          201,
          JSON.stringify({
            paymentId: 'pay-walkin-1',
            bookingId: body.bookingId ?? 'b-walkin',
            type: body.type ?? 'DEPOSIT',
            method: body.method ?? 'CASH',
            amount: body.amount ?? 300_000,
            status: 'SUCCEEDED',
            providerTxnId: null,
            paymentUrl: null,
            expiresAt: null,
            paidAt: '2026-12-24T03:10:00.000Z',
            createdAt: '2026-12-24T03:10:00.000Z',
            createdBy: null,
          }),
        );
        return;
      }
    await route.fallback();
  });
  return spy;
}
