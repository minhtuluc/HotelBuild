import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fulfillJson } from './operations-web/fake-api';
import { operationsWebOnly } from './operations-web/guard';
import {
  seedCollection,
  fixtureOrigin,
  loginCollectionStaff,
  logoutCollectionStaff,
} from './operations-web/collect-fixture';

/**
 * SCR-37 (HB-109) — back-office gọi API trực tiếp nên ca này khoá ở `/api/v1/...`. Trọng tâm: PIN **bắt
 * buộc trước lệnh tài chính** (sai cho nhập lại, khoá thì chặn hẳn), thân lệnh `POST /payments` mang
 * `pinToken` và **không** có dữ liệu thẻ.
 */
operationsWebOnly();

const BOOKINGS = /\/api\/v1\/bookings/;
/** SCR-32 (chi tiết booking) gọi qua phiên BFF từ HB-201 — cần chặn cho lối vào màn thu tiền. */
const BOOKING_DETAIL = '**/api/session/sys/bookings/**';
const PIN = /\/api\/v1\/auth\/pin\/verify/;
const PAYMENTS = /\/api\/v1\/payments/;

const BOOKING = {
  id: 'b1',
  code: 'PH-2601-00001',
  seq: 1,
  status: 'HELD',
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
  paidAmount: 0,
  refundedAmount: 0,
  balanceDue: 2_000_000,
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
  createdAt: '2026-12-01T00:00:00.000Z',
};

const PAYMENT = {
  paymentId: 'pay-1',
  bookingId: 'b1',
  type: 'DEPOSIT',
  method: 'CASH',
  amount: 600_000,
  status: 'SUCCEEDED',
  providerTxnId: null,
  paymentUrl: null,
  expiresAt: null,
  paidAt: '2026-12-02T03:00:00.000Z',
  createdAt: '2026-12-02T03:00:00.000Z',
};

interface Spy {
  readonly payments: string[];
  pins: number;
}

async function stubCollect(
  page: Page,
  options: { readonly pin?: 'ok' | 'wrong' | 'locked'; readonly balanceDue?: number } = {},
): Promise<Spy> {
  await loginCollectionStaff(page);
  const spy: Spy = { payments: [], pins: 0 };
  await page.route(BOOKING_DETAIL, (route) => fulfillJson(route, 200, JSON.stringify(BOOKING)));
  await page.route(BOOKINGS, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/balance'))
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
          balanceDue: options.balanceDue ?? 2_000_000,
        }),
      );
    return fulfillJson(route, 200, JSON.stringify(BOOKING));
  });
  await page.route(PIN, (route) => {
    spy.pins += 1;
    if (options.pin === 'locked')
      return fulfillJson(
        route,
        403,
        JSON.stringify({
          code: 'E_AUTH_PIN_LOCKED',
          message: 'PIN bị khoá',
          traceId: 't1',
          timestamp: '2026-12-02T00:00:00.000Z',
          path: '/api/v1/auth/pin/verify',
          retryAfterSeconds: 900,
        }),
      );
    if (options.pin === 'wrong')
      return fulfillJson(
        route,
        401,
        JSON.stringify({
          code: 'E_AUTH_INVALID_CREDENTIALS',
          message: 'PIN sai',
          traceId: 't1',
          timestamp: '2026-12-02T00:00:00.000Z',
          path: '/api/v1/auth/pin/verify',
        }),
      );
    return fulfillJson(
      route,
      200,
      JSON.stringify({
        pinToken: 'token-1234567890123456',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    );
  });
  await page.route(PAYMENTS, (route) => {
    spy.payments.push(route.request().postData() ?? '');
    return fulfillJson(route, 201, JSON.stringify(PAYMENT));
  });
  return spy;
}

test.describe('SCR-37 thu cọc/thu số dư tại quầy (HB-109)', () => {
  test('PIN bắt buộc: sai cho nhập lại, đúng mới mở nút ghi nhận tiền (AC1)', async ({ page }) => {
    const spy = await stubCollect(page, { pin: 'wrong' });
    await page.goto('/bookings/b1/collect');
    await expect(page.getByTestId('pin-required')).toBeVisible();
    await expect(page.getByTestId('collect-send')).toBeDisabled();

    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-wrong')).toContainText('PIN không đúng');
    await expect(page.getByTestId('collect-send')).toBeDisabled();
    expect(spy.payments).toHaveLength(0);

    await page.unroute(PIN);
    await stubCollect(page, { pin: 'ok' });
    await page.goto('/bookings/b1/collect');
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await expect(page.getByTestId('collect-send')).toBeEnabled();
    expect(spy.pins).toBeGreaterThanOrEqual(1);
  });

  test('PIN bị khoá thì chặn hẳn lệnh tài chính, không gọi payments (AC1)', async ({ page }) => {
    const spy = await stubCollect(page, { pin: 'locked' });
    await page.goto('/bookings/b1/collect');
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-locked')).toContainText('PIN bị khoá');
    await expect(page.getByTestId('collect-send')).toBeDisabled();
    expect(spy.payments).toHaveLength(0);
  });

  test('số tiền vượt mức máy chủ còn ghi nhận thì không gửi dù PIN đã đúng (AC1)', async ({
    page,
  }) => {
    const spy = await stubCollect(page, { pin: 'ok', balanceDue: 1_400_000 });
    await page.goto('/bookings/b1/collect');
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await page.getByLabel('Số tiền (VND)').fill('999999999');
    await expect(page.getByTestId('collect-issue')).toContainText('vượt mức');
    await page.getByTestId('collect-send').click();
    expect(spy.payments).toHaveLength(0);
  });

  test('ghi nhận tiền xong: thân lệnh có pinToken, không dữ liệu thẻ, hiện biên lai (AC1)', async ({
    page,
  }) => {
    const spy = await stubCollect(page, { pin: 'ok' });
    await page.goto('/bookings/b1/collect');
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await page.getByLabel('Số tiền (VND)').fill('600000');
    await page.getByTestId('collect-send').click();

    await expect(page.getByTestId('collect-receipt')).toBeVisible();
    await expect(page.getByTestId('collect-receipt')).toContainText('pay-1');
    await expect(page.getByTestId('collect-receipt')).toContainText('600000');
    await expect(page.getByTestId('collect-print')).toBeVisible();
    expect(spy.payments).toHaveLength(1);
    expect(spy.payments[0]).toContain('"pinToken":"token-1234567890123456"');
    expect(spy.payments[0]).toContain('"type":"DEPOSIT"');
    expect(spy.payments[0]).not.toContain('card');
  });

  test('màn chi tiết booking có lối vào thu tiền (AC1)', async ({ page }) => {
    await stubCollect(page);
    await page.goto('/bookings/b1');
    await expect(page.getByTestId('booking-open-collect')).toHaveAttribute(
      'href',
      '/bookings/b1/collect',
    );
  });

  test('không có vi phạm axe serious/critical và không cuộn ngang 360 px (AC2)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await stubCollect(page, { pin: 'ok' });
    await page.goto('/bookings/b1/collect');
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
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

test.describe('SCR-37 session và fake HTTP thật', () => {
  test('phiên staff gửi bearer/PIN, thu đúng khoản server trả và nhận biên lai', async ({
    page,
    request,
  }, testInfo) => {
    const { booking } = await seedCollection(page, request);
    await page.goto(`/bookings/${booking.id}/collect`);
    await expect(page.getByTestId('collect-booking')).toContainText(booking.code);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: testInfo.outputPath('pin-360.png'), fullPage: true });
    await page.getByLabel('PIN (6 chữ số)').fill('000000');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-wrong')).toBeVisible();
    await expect(page.getByTestId('collect-send')).toBeDisabled();
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await expect(page.getByLabel('PIN (6 chữ số)')).toHaveCount(0);
    const payment = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/payments') && r.status() === 201,
    );
    await page.getByTestId('collect-send').click();
    const response = await payment;
    expect(response.request().headers()['authorization']).toMatch(/^Bearer synthetic-access-/);
    expect(response.request().postData()).toContain(`"amount":${booking.depositAmount}`);
    await expect(page.getByTestId('collect-receipt')).toBeVisible();
    await expect(page.getByTestId('collect-print')).toBeVisible();
    const created = await response.json();
    await expect(page.getByTestId('collect-receipt')).toContainText(created.createdBy);
    await page.evaluate(() =>
      window.addEventListener(
        'beforeprint',
        () => {
          document.documentElement.dataset.receiptPrinted = 'true';
        },
        { once: true },
      ),
    );
    await page.getByTestId('collect-print').click();
    await expect(page.locator('html')).toHaveAttribute('data-receipt-printed', 'true');
    await page.screenshot({ path: testInfo.outputPath('receipt-360.png'), fullPage: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('collect-send')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('collect-send')).toBeDisabled();
    await expect(page.getByTestId('pin-verified')).toHaveCount(0);
  });

  test('PIN hết hạn theo expiresAt server thì phải nhập lại trước thu', async ({
    page,
    request,
  }) => {
    const { booking } = await seedCollection(page, request);
    await page.clock.install();
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await page.clock.fastForward(300_001);
    await expect(page.getByTestId('pin-required')).toBeVisible();
    await expect(page.getByTestId('collect-send')).toBeDisabled();
  });

  test('mất cả phản hồi và replay sau commit: đọc số dư không mở lại lệnh thu mới', async ({
    page,
    request,
  }) => {
    const { booking } = await seedCollection(page, request);
    const keys: string[] = [];
    let authorization = '';
    await page.route(PAYMENTS, async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      authorization = route.request().headers()['authorization'] ?? '';
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    });
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await page.getByTestId('collect-send').click();
    await expect(page.getByTestId('collect-screen').getByRole('alert')).toContainText(
      'Chưa xác định kết quả',
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe('');
    expect(keys[1]).toBe(keys[0]);
    const balance = await request.get(`${fixtureOrigin}/api/v1/bookings/${booking.id}/balance`, {
      headers: { authorization },
    });
    expect(await balance.json()).toMatchObject({ paidAmount: booking.depositAmount });
    await page.getByTestId('collect-screen').getByRole('alert').getByRole('button').click();
    await expect(page.getByTestId('collect-screen').getByRole('alert')).toContainText(
      'Chưa xác định kết quả',
    );
    await expect(page.getByTestId('collect-send')).toHaveCount(0);
    expect(keys).toHaveLength(2);
  });

  test('Payment đã SUCCEEDED vẫn có biên lai dù đọc lại balance mất mạng', async ({
    page,
    request,
  }) => {
    const { booking } = await seedCollection(page, request);
    let committed = false;
    let failedBalanceReads = 0;
    page.on('response', (response) => {
      if (response.url().endsWith('/api/v1/payments') && response.status() === 201)
        committed = true;
    });
    await page.route(/\/api\/v1\/bookings\/[^/]+\/balance$/, async (route) => {
      if (committed) {
        failedBalanceReads += 1;
        await route.abort('failed');
      } else await route.continue();
    });
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await page.getByTestId('collect-send').click();
    await expect(page.getByTestId('collect-receipt')).toBeVisible();
    await expect.poll(() => failedBalanceReads).toBe(2);
    await expect(page.getByTestId('collect-receipt')).toContainText('SUCCEEDED');
    await expect(page.getByTestId('collect-send')).toHaveCount(0);
  });
});

test.describe('SCR-37 ranh giới quyền và hộp thoại', () => {
  test('PIN dialog giữ focus, Escape đóng và có thể mở lại', async ({ page, request }) => {
    const { booking } = await seedCollection(page, request);
    await page.goto(`/bookings/${booking.id}/collect`);
    const pin = page.getByLabel('PIN (6 chữ số)');
    await expect(pin).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('pin-cancel')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(pin).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('collect-send')).toBeDisabled();
    await page.getByTestId('pin-open').click();
    await expect(pin).toBeFocused();
  });

  test('lệnh trả 403 phải che dữ liệu booking đã tải', async ({ page, request }) => {
    const { booking } = await seedCollection(page, request);
    await page.route(PAYMENTS, (route) =>
      fulfillJson(
        route,
        403,
        JSON.stringify({
          code: 'E_RBAC_FORBIDDEN',
          message: 'Synthetic denied response',
          traceId: 'synthetic-denied',
          timestamp: new Date().toISOString(),
          path: '/api/v1/payments',
        }),
      ),
    );
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await page.getByTestId('collect-send').click();
    await expect(page.getByTestId('collect-screen')).toContainText('Bạn không có quyền');
    await expect(page.getByTestId('collect-booking')).toHaveCount(0);
    await expect(page.getByTestId('collect-balance')).toHaveCount(0);
    await expect(page.getByTestId('collect-send')).toHaveCount(0);
  });
});

test.describe('SCR-37 trạng thái §8.1', () => {
  const states = {
    ready: 'Thu cọc / thu số dư tại quầy',
    loading: 'Đang tải…',
    refreshing: 'Cập nhật lúc',
    empty: 'Chưa có dữ liệu',
    'validation-error': 'Vui lòng sửa 1 trường được đánh dấu',
    forbidden: 'Bạn không có quyền xem nội dung này',
    conflict: 'Dữ liệu đã thay đổi',
    expired: 'Nội dung đã hết hạn lúc',
    'unknown-outcome': 'Chưa xác định kết quả',
    success: 'Máy chủ đã xác nhận',
  };
  for (const [state, text] of Object.entries(states)) {
    test(`${state}: nội dung và axe`, async ({ page }) => {
      await loginCollectionStaff(page); // khu vực nhân viên đã yêu cầu đăng nhập (HB-020)
      await page.goto(`/bookings/synthetic-demo/collect?state=${state}`);
      await expect(page.getByTestId('collect-screen')).toContainText(text);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => v.id),
      ).toEqual([]);
    });
  }
});

test.describe('SCR-37 phiên và lỗi xác thực', () => {
  test('logout tab khác che dữ liệu và chặn phản hồi PIN đang bay', async ({
    page,
    request,
    context,
  }) => {
    const { booking } = await seedCollection(page, request);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pending = false;
    await page.route(PIN, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      pending = true;
      await gate;
      await route.fulfill({ response });
    });
    await page.goto(`/bookings/${booking.id}/collect`);
    const completed = page.waitForResponse(
      (r) => r.url().endsWith('/auth/pin/verify') && r.status() === 200,
    );
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect.poll(() => pending).toBe(true);
    const other = await context.newPage();
    try {
      await logoutCollectionStaff(other);
      // HB-020: hết phiên ở tab khác ⇒ khu vực nhân viên đưa tab này về /login (thay cho trạng thái thiếu quyền tại màn).
      await expect(page).toHaveURL(/\/login\?.*reason=expired/);
    } finally {
      release();
      await other.close();
    }
    await (await completed).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page).toHaveURL(/\/login\?.*reason=expired/);
    await expect(page.getByTestId('collect-screen')).toHaveCount(0);
    await expect(page.getByTestId('pin-verified')).toHaveCount(0);
    await expect(page.getByTestId('collect-booking')).toHaveCount(0);
    await expect(page.getByTestId('collect-send')).toHaveCount(0);
  });

  test('server từ chối PIN hết hạn thì mở nhập PIN lại, không gọi đó là thiếu quyền', async ({
    page,
    request,
  }) => {
    const { booking } = await seedCollection(page, request);
    await page.route(PAYMENTS, (route) =>
      fulfillJson(
        route,
        401,
        JSON.stringify({
          code: 'E_AUTH_PIN_REQUIRED',
          message: 'Synthetic rejected grant',
          traceId: 'synthetic-pin-expired',
          timestamp: new Date().toISOString(),
          path: '/api/v1/payments',
        }),
      ),
    );
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await page.getByTestId('collect-send').click();
    await expect(page.getByLabel('PIN (6 chữ số)')).toBeVisible();
    await expect(page.getByTestId('collect-send')).toBeDisabled();
    await expect(page.getByTestId('collect-screen')).not.toContainText('Bạn không có quyền');
  });

  test('PIN verify mất mạng không báo PIN sai', async ({ page, request }) => {
    const { booking } = await seedCollection(page, request);
    await page.route(PIN, (route) => route.abort('failed'));
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-unavailable')).toBeVisible();
    await expect(page.getByTestId('pin-wrong')).toHaveCount(0);
    await expect(page.getByTestId('collect-send')).toBeDisabled();
  });

  test('PIN verify 403 che booking đã tải', async ({ page, request }) => {
    const { booking } = await seedCollection(page, request);
    await page.route(PIN, (route) =>
      fulfillJson(
        route,
        403,
        JSON.stringify({
          code: 'E_RBAC_FORBIDDEN',
          message: 'Synthetic denied PIN',
          traceId: 'synthetic-denied',
          timestamp: new Date().toISOString(),
          path: '/api/v1/auth/pin/verify',
        }),
      ),
    );
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('collect-screen')).toContainText('Bạn không có quyền');
    await expect(page.getByTestId('collect-booking')).toHaveCount(0);
    await expect(page.getByTestId('pin-wrong')).toHaveCount(0);
  });

  test('Payment đã xác nhận nhưng balance trả 403 thì che dữ liệu bảo vệ', async ({
    page,
    request,
  }) => {
    const { booking } = await seedCollection(page, request);
    let committed = false;
    page.on('response', (response) => {
      if (response.url().endsWith('/api/v1/payments') && response.status() === 201)
        committed = true;
    });
    await page.route(/\/api\/v1\/bookings\/[^/]+\/balance$/, async (route) => {
      if (!committed) return route.continue();
      await fulfillJson(
        route,
        403,
        JSON.stringify({
          code: 'E_RBAC_FORBIDDEN',
          message: 'Synthetic denied read',
          traceId: 'synthetic-denied',
          timestamp: new Date().toISOString(),
          path: route.request().url(),
        }),
      );
    });
    await page.goto(`/bookings/${booking.id}/collect`);
    await page.getByLabel('PIN (6 chữ số)').fill('123456');
    await page.getByTestId('pin-submit').click();
    await expect(page.getByTestId('pin-verified')).toBeVisible();
    await page.getByTestId('collect-send').click();
    await expect(page.getByTestId('collect-screen')).toContainText('Bạn không có quyền');
    await expect(page.getByTestId('collect-booking')).toHaveCount(0);
    await expect(page.getByTestId('collect-receipt')).toHaveCount(0);
  });
});

// Instrument native channels without replacing their coordination behavior.
declare global {
  interface Window {
    collectionChannels: { created: number; closed: number };
  }
}

test('SCR-37 retry sau khi rời màn không tạo lại session channel', async ({ page, request }) => {
  await page.addInitScript(() => {
    window.collectionChannels = { created: 0, closed: 0 };
    const NativeChannel = window.BroadcastChannel;
    window.BroadcastChannel = class extends NativeChannel {
      constructor(name: string) {
        super(name);
        window.collectionChannels.created += 1;
      }
      override close(): void {
        window.collectionChannels.closed += 1;
        super.close();
      }
    };
  });
  const { booking } = await seedCollection(page, request);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(PAYMENTS, async (route) => {
    calls += 1;
    if (calls === 1) await gate;
    await route.abort('failed');
  });
  await page.goto(`/bookings/${booking.id}/collect`);
  await page.getByLabel('PIN (6 chữ số)').fill('123456');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('pin-verified')).toBeVisible();
  await page.getByTestId('collect-send').click();
  await expect.poll(() => calls).toBe(1);
  const detailRead = page.waitForResponse((response) =>
    response.url().includes('/api/session/sys/bookings/'),
  );
  await page.getByTestId('collect-back').click();
  await expect(page.getByTestId('collect-screen')).toHaveCount(0);
  await detailRead;
  // HB-201: màn chi tiết booking (SCR-32, đích của nút quay lại) nay cũng mở phiên riêng nên tổng số
  // kênh gồm cả kênh của màn đó; điều cần khoá là **lần gửi lại không mở thêm kênh nào**.
  const afterLeave = await page.evaluate(() => ({ ...window.collectionChannels }));
  expect(afterLeave.closed).toBeGreaterThanOrEqual(1);
  release();
  await expect.poll(() => calls).toBe(2);
  expect(await page.evaluate(() => window.collectionChannels)).toEqual(afterLeave);
});
