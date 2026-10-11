import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { operationsWebOnly } from './operations-web/guard';
import { seedRefund, loginRefundStaff, verifyRefundPin, seedApprovedRefund, prepareRefundPay, readRefundLedger } from './operations-web/refund-fixture';
import { fixtureOrigin, logoutCollectionStaff } from './operations-web/collect-fixture';
const DEMO_STATES = ['ready', 'loading', 'refreshing', 'empty', 'validation-error', 'forbidden', 'conflict', 'expired', 'unknown-outcome', 'success'] as const;
operationsWebOnly();
test('maker sees server gross/fee/net/reservation and cannot see approve', async ({ page, request }) => {
  const { booking, refund } = await seedRefund(page, request);
  await page.goto(`/bookings/${booking.id}/refunds`);
  await expect(page.getByTestId('refund-detail')).toBeVisible();
  await expect(page.getByTestId('refund-gross')).toContainText(String(refund.requestedAmount / 1000));
  await expect(page.getByTestId('refund-fee')).toContainText('10.000');
  await expect(page.getByTestId('refund-net')).toContainText(String(refund.netRefund! / 1000));
  await expect(page.getByTestId('refund-reserved')).toContainText(String(refund.netRefund! / 1000));
  await expect(page.getByTestId('refund-action-approve')).toHaveCount(0);
  await expect(page.getByTestId('refund-action-cancel')).toBeVisible();
  await expect(page.getByTestId('pin-dialog')).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((issue) => ['serious','critical'].includes(issue.impact ?? ''))).toEqual([]);
});
test('independent manager approves with PIN; accountant pays NET once and original stays collected', async ({ page, request }) => {
  const { booking, payment, refund } = await seedRefund(page, request);
  await loginRefundStaff(page, request, 'MANAGER');
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-action-approve').click();
  await verifyRefundPin(page);
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByTestId('refund-status')).toContainText('APPROVED');
  await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
  await loginRefundStaff(page, request, 'ACCOUNTANT');
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-action-pay').click();
  await verifyRefundPin(page);
  await page.locator('textarea[name="note"]').fill('Synthetic bank receipt; recipient verified');
  await page.getByLabel('Đã xác minh người nhận').check();
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByTestId('refund-paid-evidence')).toBeVisible();
  await expect(page.getByTestId('refund-status')).toContainText('PAID');
  await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
  await expect(page.getByTestId('refund-paid-evidence')).toContainText('REFUND');
  const ledger = await readRefundLedger(page, booking.id, payment.paymentId);
  expect(ledger.original).toMatchObject({ amount: payment.amount, status: 'SUCCEEDED' });
  expect(ledger.balance).toMatchObject({ refundedAmount: refund.netRefund, reservedRefundAmount: 0 });
});



for (const committed of [false, true]) test(`unknown payout committed=${committed}: same key, lookup proof only, no new payout`, async ({ page, request }) => {
  const { booking, refund } = await seedApprovedRefund(page, request);
  const keys: string[] = [];
  await page.route(/\/api\/v1\/refund-requests\/[^/]+\/pay$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']!);
    if (committed) expect((await route.fetch()).status()).toBe(200);
    await route.abort('failed');
  });
  await prepareRefundPay(page, booking.id);
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(1);
  await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tra cứu kết quả' }).click();
  if (committed) {
    await expect(page.getByTestId('refund-paid-evidence')).toBeVisible();
    await expect(page.getByTestId('refund-status')).toContainText('PAID');
  } else {
    await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
    await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
    await expect(page.getByTestId('refund-paid-evidence')).toHaveCount(0);
  }
  expect(keys).toHaveLength(2);
  const ledger = await readRefundLedger(page, booking.id);
  expect(ledger.balance).toMatchObject({ refundedAmount: committed ? refund.netRefund : 0, reservedRefundAmount: committed ? 0 : refund.netRefund });
});
test('unknown payout survives SPA remount, reload and another tab without a new key', async ({ page, request, context }) => {
  const { booking } = await seedApprovedRefund(page, request);
  const keys: string[] = [];
  await context.route(/\/api\/v1\/refund-requests\/[^/]+\/pay$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']!);
    await route.abort('failed');
  });
  await prepareRefundPay(page, booking.id);
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  await page.getByRole('link', { name: 'Chi tiết đơn', exact: true }).click();
  await expect(page.getByTestId('refund-screen')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  const other = await context.newPage();
  await other.goto(`/bookings/${booking.id}/refunds`);
  await expect(other.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  await other.getByRole('button', { name: 'Tra cứu kết quả' }).click();
  await expect(other.getByTestId('refund-action-pay')).toHaveCount(0);
  expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(1);
  await other.close();
});
test('leaving while payout POST is pending retains a private barrier in another tab', async ({ page, request, context }) => {
  const { booking, refund } = await seedApprovedRefund(page, request);
  let release!: () => void; const delayed = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void; const seen = new Promise<void>((resolve) => { reached = resolve; });
  let writes = 0;
  await context.route(/\/api\/v1\/refund-requests\/[^/]+\/pay$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++; reached(); await delayed; await route.abort('failed');
  });
  await prepareRefundPay(page, booking.id);
  await page.getByTestId('refund-confirm').click(); await seen;
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('pinehill-refund-payout-v1:')));
  expect(stored).toHaveLength(1);
  expect(stored[0]![0]).not.toContain(refund.id);
  expect(stored[0]![1]).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  await page.getByRole('link', { name: 'Chi tiết đơn', exact: true }).click();
  const other = await context.newPage(); await other.goto(`/bookings/${booking.id}/refunds`);
  await expect(other.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  await expect(other.getByTestId('refund-action-pay')).toHaveCount(0);
  expect(writes).toBe(1);
  release(); await other.close();
});
test('two prepared tabs claim one payout key and cannot send a second command', async ({ page, request, context }) => {
  const { booking } = await seedApprovedRefund(page, request);
  const other = await context.newPage();
  await prepareRefundPay(page, booking.id); await prepareRefundPay(other, booking.id);
  const keys: string[] = [];
  await context.route(/\/api\/v1\/refund-requests\/[^/]+\/pay$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']!); await route.abort('failed');
  });
  await Promise.all([page.getByTestId('refund-confirm').click(), other.getByTestId('refund-confirm').click()]);
  await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(1);
  await other.close();
});
test('a stale prepared tab cannot create a new key after another tab confirms successful payout', async ({ page, request, context }) => {
  const { booking } = await seedApprovedRefund(page, request);
  const other = await context.newPage();
  await prepareRefundPay(page, booking.id); await prepareRefundPay(other, booking.id);
  const keys: string[] = [];
  context.on('request', (value) => { if (value.method() === 'POST' && value.url().endsWith('/pay')) keys.push(value.headers()['idempotency-key']!); });
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByTestId('refund-paid-evidence')).toBeVisible();
  await other.getByTestId('refund-confirm').click();
  await expect(other.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  await other.getByRole('button', { name: 'Tra cứu kết quả' }).click();
  await expect(other.getByTestId('refund-paid-evidence')).toBeVisible();
  expect(keys).toHaveLength(1);
  await other.close();
});
test('unwritable payout storage never sends money', async ({ page, request }) => {
  const { booking } = await seedApprovedRefund(page, request);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('pinehill-refund-payout-v1:')) throw new DOMException('Synthetic unavailable', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  let writes = 0; page.on('request', (value) => { if (value.method() === 'POST' && value.url().endsWith('/pay')) writes++; });
  await prepareRefundPay(page, booking.id); await page.getByTestId('refund-confirm').click();
  await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  expect(writes).toBe(0);
});
test('approval PIN preflight rejection keeps entered decision and allows fresh PIN', async ({ page, request }) => {
  const { booking } = await seedRefund(page, request);
  await loginRefundStaff(page, request, 'MANAGER');
  await page.route(/\/api\/v1\/refund-requests\/[^/]+\/approve$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://127.0.0.1:' + (process.env.E2E_OPERATIONS_WEB_PORT ?? '3002') }, body: JSON.stringify({ code: 'E_AUTH_PIN_REQUIRED', traceId: 'synthetic-pin-preflight', message: 'Synthetic', timestamp: new Date().toISOString(), path: '/api/v1/refund-requests/synthetic/approve' }) });
  });
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-action-approve').click(); await verifyRefundPin(page);
  await page.locator('input[name="approvedAmount"]').fill('100000');
  await page.locator('textarea[name="note"]').fill('Synthetic reduction retained');
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByTestId('pin-wrong')).toBeVisible();
  await expect(page.getByTestId('refund-detail')).toBeVisible();
  await expect(page.locator('input[name="approvedAmount"]')).toHaveValue('100000');
  await expect(page.locator('textarea[name="note"]')).toHaveValue('Synthetic reduction retained');
  await expect(page.getByTestId('refund-confirm')).toBeDisabled();
  await verifyRefundPin(page);
  await expect(page.getByTestId('refund-confirm')).toBeEnabled();
});
for (const failure of ['wrong', 'locked', 'unavailable', 'denied']) test(`PIN ${failure} never sends approval`, async ({ page, request }) => {
  const { booking } = await seedRefund(page, request);
  await loginRefundStaff(page, request, 'MANAGER');
  let writes = 0;
  page.on('request', (value) => { if (value.method() === 'POST' && value.url().endsWith('/approve')) writes++; });
  if (failure === 'locked') {
    const token = await page.evaluate(() => window.sessionClient!.getAccessToken());
    expect((await request.post(`${fixtureOrigin}/__control/f5/bookings/${booking.id}`, { headers: { authorization: `Bearer ${token}` }, data: { event: 'pin-locked' } })).status()).toBe(200);
  }
  if (['unavailable', 'denied'].includes(failure)) await page.route(/\/api\/v1\/auth\/pin\/verify$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (failure === 'unavailable') return route.abort('failed');
    return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': 'http://127.0.0.1:' + (process.env.E2E_OPERATIONS_WEB_PORT ?? '3002') }, body: JSON.stringify({ code: 'E_RBAC_FORBIDDEN', traceId: 'synthetic-denial', message: 'Synthetic', timestamp: new Date().toISOString(), path: '/api/v1/auth/pin/verify' }) });
  });
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-action-approve').click();
  await page.locator('input[name="pin"]').fill(failure === 'wrong' ? '000000' : '123456');
  await page.getByTestId('pin-submit').click();
  if (failure === 'denied') await expect(page.getByTestId('refund-detail')).toHaveCount(0);
  else {
    await expect(page.getByTestId(`pin-${failure}`)).toBeVisible();
    await expect(page.getByTestId('refund-confirm')).toBeDisabled();
  }
  expect(writes).toBe(0);
});

test('PIN expiry requires fresh verification before approval; keyboard Escape clears entry', async ({ page, request }) => {
  const { booking } = await seedRefund(page, request);
  await loginRefundStaff(page, request, 'MANAGER');
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-action-approve').click();
  await page.locator('input[name="pin"]').fill('123');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pin-dialog')).toHaveCount(0);
  await page.getByTestId('pin-open').click();
  await expect(page.locator('input[name="pin"]')).toHaveValue('');
  await page.clock.install();
  await verifyRefundPin(page);
  await page.clock.fastForward(300001);
  await expect(page.getByTestId('refund-confirm')).toBeDisabled();
  await expect(page.getByTestId('pin-verified')).toHaveCount(0);
});
test('cross-tab logout during pending PIN hides money and cannot restore late grant', async ({ page, request, context }) => {
  const { booking } = await seedRefund(page, request);
  await loginRefundStaff(page, request, 'MANAGER');
  let release!: () => void; const delayed = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void; const seen = new Promise<void>((resolve) => { reached = resolve; });
  await page.route(/\/api\/v1\/auth\/pin\/verify$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); reached(); await delayed; await route.fulfill({ response });
  });
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-action-approve').click();
  await page.locator('input[name="pin"]').fill('123456'); await page.getByTestId('pin-submit').click();
  await seen;
  const other = await context.newPage(); await logoutCollectionStaff(other);
  await expect(page.getByTestId('refund-detail')).toHaveCount(0);
  release(); await expect(page.getByTestId('pin-verified')).toHaveCount(0);
  await expect(page.getByTestId('refund-form')).toHaveCount(0);
  await other.close();
});
test('server PAID without successful payment proof stays unverified with no pay control', async ({ page, request }) => {
  const { booking } = await seedApprovedRefund(page, request);
  await page.route(/\/api\/v1\/refund-requests\?/, async (route) => {
    const response = await route.fetch(); const body = await response.json();
    body.data[0].status = 'PAID'; body.data[0].evidenceRefs = ['synthetic-reason-document'];
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/bookings/${booking.id}/refunds`);
  await expect(page.getByTestId('refund-status')).toContainText('Chưa xác minh');
  await expect(page.getByTestId('refund-paid-evidence')).toHaveCount(0);
  await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
});
for (const slug of DEMO_STATES) test(`SCR38 state ${slug}: no request and axe clean`, async ({ page }) => {
  let calls = 0; page.on('request', (value) => { if (value.url().includes('/api/v1/')) calls++; });
  await page.goto(`/bookings/synthetic/refunds?state=${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? ''))).toEqual([]);
  expect(calls).toBe(0);
});

test('maker creates another server-priced request and withdraws it with reason, releasing only its reservation', async ({ page, request }) => {
  const { booking, refund } = await seedRefund(page, request);
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-create').click();
  const pending = page.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname === '/api/v1/refund-requests');
  await page.getByTestId('refund-confirm').click();
  const response = await pending; expect(response.status()).toBe(201);
  const created = await response.json();
  await page.getByRole('button', { name: `Xem hồ sơ ${created.id}`, exact: true }).click();
  await page.getByTestId('refund-action-cancel').click();
  await expect(page.getByTestId('refund-confirm')).toBeDisabled();
  await page.locator('textarea[name="note"]').fill('Synthetic withdrawal');
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByTestId('refund-status')).toContainText('CANCELLED');
  const ledger = await readRefundLedger(page, booking.id);
  expect(ledger.balance).toMatchObject({ refundedAmount: 0, reservedRefundAmount: refund.netRefund });
});
test('approval reduction rereads server NET and zero approval never opens payout', async ({ page, request }) => {
  const { booking } = await seedRefund(page, request);
  await loginRefundStaff(page, request, 'MANAGER');
  await page.goto(`/bookings/${booking.id}/refunds`);
  await page.getByTestId('refund-action-approve').click(); await verifyRefundPin(page);
  await page.locator('input[name="approvedAmount"]').fill('0');
  await expect(page.getByTestId('refund-confirm')).toBeDisabled();
  await page.locator('textarea[name="note"]').fill('Synthetic reduction to zero');
  await page.getByTestId('refund-confirm').click();
  await expect(page.getByTestId('refund-status')).toContainText('APPROVED');
  await expect(page.getByTestId('refund-net')).toContainText('0');
  const ledger = await readRefundLedger(page, booking.id);
  expect(ledger.balance.reservedRefundAmount).toBe(0);
  await loginRefundStaff(page, request, 'ACCOUNTANT'); await page.goto(`/bookings/${booking.id}/refunds`);
  await expect(page.getByTestId('refund-detail')).toBeVisible();
  await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
});
test('multi-method allocations render each original and server event threshold; unsupported single-method command stays closed', async ({ page, request }) => {
  const { booking } = await seedApprovedRefund(page, request);
  await page.route(/\/api\/v1\/refund-requests\?/, async (route) => {
    const response = await route.fetch(); const body = await response.json(); const value = body.data[0];
    const first = value.refundAllocations[0];
    value.refundAllocations = [ { ...first, amount: 70000 }, { ...first, amount: 70000, payoutMethod: 'MOMO', originalPayment: { ...first.originalPayment, paymentId: 'synthetic-second-source', method: 'MOMO', amount: 70000 } } ];
    value.netRefund = 140000; value.eventNetRefund = 6000000; value.requiresThresholdControl = true;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/bookings/${booking.id}/refunds`);
  await expect(page.getByTestId('refund-sources').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('refund-sources')).toContainText('MOMO');
  await expect(page.getByTestId('refund-threshold')).toBeVisible();
  await expect(page.getByTestId('refund-action-pay')).toHaveCount(0);
});
test('360px PIN and confirmed payout are accessible and do not overflow', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const { booking } = await seedApprovedRefund(page, request);
  await page.goto(`/bookings/${booking.id}/refunds`); await page.getByTestId('refund-action-pay').click();
  await expect(page.getByTestId('pin-dialog')).toBeVisible();
  const before = await new AxeBuilder({ page }).analyze();
  expect(before.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? ''))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('pin-360.png'), fullPage: true });
  await verifyRefundPin(page);
  await page.locator('textarea[name="note"]').fill('Synthetic bank receipt; recipient verified'); await page.getByLabel('Đã xác minh người nhận').check();
  await page.getByTestId('refund-confirm').click(); await expect(page.getByTestId('refund-paid-evidence')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const after = await new AxeBuilder({ page }).analyze();
  expect(after.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? ''))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('paid-360.png'), fullPage: true });
});

test('late read denial hides old money even if another parallel read failed first', async ({ page, request }) => {
  const { booking } = await seedRefund(page, request);
  await page.goto(`/bookings/${booking.id}/refunds`);
  await expect(page.getByTestId('refund-detail')).toBeVisible();
  const denial = (path: string, code: string) => ({ code, traceId: 'synthetic-denial', message: 'Synthetic', timestamp: new Date().toISOString(), path });
  await page.route(/\/api\/v1\/bookings\/[^/]+\/balance$/, async (route) => route.fulfill({ status: 400, headers: { 'access-control-allow-origin': `http://127.0.0.1:${process.env.E2E_OPERATIONS_WEB_PORT ?? '3002'}` }, json: denial(new URL(route.request().url()).pathname, 'E_GEN_VALIDATION_FAILED') }));
  await page.route(/\/api\/v1\/refund-requests\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 403, headers: { 'access-control-allow-origin': `http://127.0.0.1:${process.env.E2E_OPERATIONS_WEB_PORT ?? '3002'}` }, json: denial('/api/v1/refund-requests', 'E_RBAC_FORBIDDEN') });
  });
  await page.getByTestId('refund-reload').click();
  await expect(page.getByTestId('refund-detail')).toHaveCount(0);
  await expect(page.getByTestId('refund-create')).toHaveCount(0);
});
