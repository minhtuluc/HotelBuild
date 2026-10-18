import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { errorBody, fulfillJson, listBody } from './operations-web/fake-api';
import { operationsWebOnly } from './operations-web/guard';
import { loginRefundStaff } from './operations-web/refund-fixture';

/**
 * SCR-33/SCR-34 (HB-107) — back-office gọi qua BFF phiên nhân viên nên ca này khoá ở
 * `/api/session/sys/...` và trả phản hồi đúng hợp đồng. Trọng tâm: luồng ≤ 5 bước,
 * **holdMinutes lấy từ cấu hình kênh**, và **giá theo báo giá**.
 */
operationsWebOnly();

// Client phiên không gửi request nào khi chưa đăng nhập, nên mỗi ca phải có phiên nhân viên trước.
test.beforeEach(async ({ page, request }) => {
  await loginRefundStaff(page, request, 'OWNER');
});

const CHANNELS = /\/api\/session\/sys\/channels/;
const AVAILABILITY = /\/api\/session\/sys\/inventory\/availability/;
const RATE_PLANS = /\/api\/session\/sys\/rate-plans/;
const QUOTES = /\/api\/session\/sys\/quotes/;
const BOOKINGS = /\/api\/session\/sys\/bookings/;
const GUESTS = /\/api\/session\/sys\/guests/;

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

const QUOTE = {
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
};

const BOOKING = {
  id: 'b1',
  code: 'PH-2601-00009',
  seq: 9,
  status: 'HELD',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'FLEX7',
  channelId: 'c-PHONE',
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
  holdExpiresAt: '2026-12-02T00:00:00.000Z',
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'staff-1',
  createdAt: '2026-12-01T00:00:00.000Z',
};

interface Spy {
  readonly bookingBodies: string[];
  readonly quoteBodies: string[];
  readonly availabilityQueries: string[];
  readonly guestQueries: string[];
}

async function stubCounter(
  page: Page,
  options: { readonly bookingStatus?: number } = {},
): Promise<Spy> {
  const spy: Spy = {
    bookingBodies: [],
    quoteBodies: [],
    availabilityQueries: [],
    guestQueries: [],
  };
  await page.route(CHANNELS, (route) =>
    fulfillJson(
      route,
      200,
      listBody([channel('WALKIN', 30), channel('PHONE', 1440), channel('WEB', 20)]),
    ),
  );
  await page.route(AVAILABILITY, (route) => {
    spy.availabilityQueries.push(new URL(route.request().url()).search.slice(1));
    return fulfillJson(
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
    );
  });
  await page.route(RATE_PLANS, (route) =>
    fulfillJson(
      route,
      200,
      listBody([
        { code: 'FLEX7', name: 'Linh hoạt 7 ngày', minNights: 1, maxNights: 365, depositPercent: 30 },
      ]),
    ),
  );
  await page.route(QUOTES, (route) => {
    spy.quoteBodies.push(route.request().postData() ?? '');
    return fulfillJson(route, 201, JSON.stringify(QUOTE));
  });
  await page.route(GUESTS, (route) => {
    spy.guestQueries.push(new URL(route.request().url()).search.slice(1));
    return fulfillJson(
      route,
      200,
      listBody([
        {
          id: 'g1',
          fullName: 'Nguyễn Văn An',
          phone: '+84912345678',
          email: null,
          loyaltyTier: 'GOLD',
          loyaltyPoints: 1200,
          totalStays: 3,
          blacklisted: false,
          consentMarketing: true,
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ]),
    );
  });
  await page.route(BOOKINGS, (route) => {
    if (route.request().method() !== 'POST') return fulfillJson(route, 200, listBody([]));
    spy.bookingBodies.push(route.request().postData() ?? '');
    if (options.bookingStatus !== undefined && options.bookingStatus !== 201)
      return fulfillJson(route, options.bookingStatus, errorBody('E_BOOK_INVALID_STATE', 't1', '/bookings'));
    return fulfillJson(route, 201, JSON.stringify({ ...BOOKING, channelId: 'c-WALKIN' }));
  });
  return spy;
}

async function fillFirstSteps(page: Page, channelCode: 'WALKIN' | 'PHONE'): Promise<void> {
  await page.getByLabel('Kênh tạo').selectOption(channelCode);
  await page.getByLabel('Cơ sở').fill('p1');
  await page.getByLabel('Nhận phòng').fill('2026-12-24');
  await page.getByLabel('Trả phòng').fill('2026-12-26');
  await page.getByTestId('new-booking-next').click();
  await expect(page.getByTestId('step-room')).toBeVisible();
  await page.getByLabel('Loại phòng').selectOption('rt1');
  await page.getByLabel('Gói giá').selectOption('FLEX7');
  await page.getByTestId('new-booking-next').click();
  await expect(page.getByTestId('step-guest')).toBeVisible();
}

test.describe('SCR-33/SCR-34 tạo booking tại quầy/điện thoại (HB-107)', () => {
  test('tại quầy đi đúng 5 bước, giá theo báo giá, tạo xong hiện mã (AC1)', async ({ page }) => {
    const spy = await stubCounter(page);
    await page.goto('/bookings/new');
    await expect(page.getByTestId('new-booking-step')).toContainText('Bước 1/5');
    await expect(page.getByTestId('step-channel-hold')).toContainText('30 phút');

    await fillFirstSteps(page, 'WALKIN');
    await page.getByLabel('Họ tên khách').fill('Nguyễn Văn An');
    await page.getByLabel('Số điện thoại khách').fill('0912345678');
    await page.getByTestId('new-booking-next').click();

    // Bước 4: giá và tiền cọc theo báo giá máy chủ trả.
    await expect(page.getByTestId('step-confirm')).toBeVisible();
    await expect(page.getByTestId('confirm-quote')).toContainText('2.000.000 ₫');
    await expect(page.getByTestId('confirm-quote')).toContainText('cọc 30% = 600.000 ₫');
    await expect(page.getByTestId('new-booking-step')).toContainText('Bước 4/5');
    expect(spy.quoteBodies[0]).toContain('"channelCode":"WALKIN"');
    expect(spy.availabilityQueries[0]).toContain('roomCount=1');

    await page.getByTestId('new-booking-next').click();
    await expect(page.getByTestId('step-done')).toBeVisible();
    await expect(page.getByTestId('done-code')).toContainText('PH-2601-00009');
    await expect(page.getByTestId('new-booking-step')).toContainText('Bước 5/5');
    expect(spy.bookingBodies[0]).toContain('"quoteId":"q1"');
    expect(spy.bookingBodies[0]).toContain('"channelCode":"WALKIN"');
    await expect(page.getByTestId('done-print')).toBeVisible();
  });

  test('kênh PHONE dùng holdMinutes của kênh và tra được khách theo SĐT (AC1)', async ({ page }) => {
    const spy = await stubCounter(page);
    await page.goto('/bookings/new');
    await page.getByLabel('Kênh tạo').selectOption('PHONE');
    await expect(page.getByTestId('step-channel-hold')).toContainText('1440 phút');
    await page.getByLabel('Cơ sở').fill('p1');
    await page.getByLabel('Nhận phòng').fill('2026-12-24');
    await page.getByLabel('Trả phòng').fill('2026-12-26');
    await page.getByTestId('new-booking-next').click();
    await page.getByLabel('Loại phòng').selectOption('rt1');
    await page.getByLabel('Gói giá').selectOption('FLEX7');
    await page.getByTestId('new-booking-next').click();

    await page.getByLabel('Số điện thoại khách').fill('0912345678');
    await page.getByTestId('guest-lookup').click();
    await expect(page.getByTestId('guest-found')).toContainText('Nguyễn Văn An');
    expect(spy.guestQueries[0]).toContain('q=0912345678');
    // Tra khách xong thì họ tên được điền sẵn theo hồ sơ.
    await expect(page.getByLabel('Họ tên khách')).toHaveValue('Nguyễn Văn An');

    await page.getByTestId('new-booking-next').click();
    await expect(page.getByTestId('confirm-hold')).toContainText('1440 phút');
    expect(spy.quoteBodies[0]).toContain('"channelCode":"PHONE"');
  });

  test('mỗi bước chặn tại chỗ khi thiếu dữ liệu, không đi tiếp (AC1)', async ({ page }) => {
    await stubCounter(page);
    await page.goto('/bookings/new');
    await page.getByTestId('new-booking-next').click();
    await expect(page.getByTestId('new-booking-issue')).toContainText('Nhập mã cơ sở');
    await expect(page.getByTestId('step-room')).toHaveCount(0);

    // Kỳ ở được kiểm ở bước 2 (bước 1 chỉ cần cơ sở): đi tiếp rồi để bước 2 chặn.
    await page.getByLabel('Cơ sở').fill('p1');
    await page.getByLabel('Nhận phòng').fill('2026-12-26');
    await page.getByLabel('Trả phòng').fill('2026-12-24');
    await page.getByTestId('new-booking-next').click();
    await expect(page.getByTestId('step-room')).toBeVisible();
    await page.getByTestId('new-booking-next').click();
    await expect(page.getByTestId('new-booking-issue')).toContainText('Ngày trả phải sau ngày nhận');
    await expect(page.getByTestId('step-guest')).toHaveCount(0);
  });

  test('máy chủ từ chối tạo booking thì không nhảy sang bước kết quả (AC1)', async ({ page }) => {
    await stubCounter(page, { bookingStatus: 409 });
    await page.goto('/bookings/new');
    await fillFirstSteps(page, 'WALKIN');
    await page.getByLabel('Họ tên khách').fill('Nguyễn Văn An');
    await page.getByLabel('Số điện thoại khách').fill('0912345678');
    await page.getByTestId('new-booking-next').click();
    await page.getByTestId('new-booking-next').click();
    // Ghi thất bại ở trạng thái rõ ràng: không nhảy bước, khối xung đột thay nội dung để không cho gửi lại mù.
    await expect(page.getByTestId('step-done')).toHaveCount(0);
    await expect(page.getByText('Chưa xác định kết quả')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  });

  test('mọi trạng thái hợp đồng §8.1 hiện được bằng ?state= (AC2)', async ({ page }) => {
    await stubCounter(page);
    for (const slug of ['forbidden', 'expired', 'unknown-outcome', 'empty', 'success']) {
      await page.goto(`/bookings/new?state=${slug}`);
      await expect(page.getByTestId('new-booking-screen')).toBeVisible();
      await expect(page.getByTestId('step-channel')).toHaveCount(0);
    }
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await stubCounter(page);
    await page.goto('/bookings/new');
    await fillFirstSteps(page, 'PHONE');
    await page.getByLabel('Họ tên khách').fill('Nguyễn Văn An');
    await page.getByLabel('Số điện thoại khách').fill('0912345678');
    await page.getByTestId('new-booking-next').click();
    await expect(page.getByTestId('confirm-quote')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => violation.id),
    ).toEqual([]);
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      return element === null ? 0 : element.scrollWidth - element.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
