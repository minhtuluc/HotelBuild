import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';
import {loginRefundStaff} from './refund-fixture';
import {logoutCollectionStaff} from './collect-fixture';

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

function roomType(id: string, code: string) {
  return {
    id,
    propertyId: 'p1',
    code,
    capacityAdults: 2,
    capacityChildren: 1,
    basePrice: 900_000,
    minPrice: 700_000,
    maxPrice: 1_400_000,
    allowShared: false,
    bedCount: 1,
    version: 1,
  };
}

const TYPES = [roomType('rt1', 'DLX'), roomType('rt2', 'SUP'), roomType('rt3', 'DOR')];

const PROPERTIES = '**/api/session/sys/properties*';
const ROOM_TYPES = '**/api/session/sys/room-types*';
const GRID = '**/api/session/sys/inventory/grid*';

operationsWebOnly();
test.beforeEach(async({page,request})=>{await loginRefundStaff(page,request,'OWNER');});

function gridBody(roomTypeId: string, from: string, to: string, pool: number, blocked = 0) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  const cells = Array.from({ length: days }, (_, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    supply: 20,
    demand: 14,
    pool,
    blocked,
  }));
  return { propertyId: 'p1', roomTypeId, from, to, cells };
}

/** Dựng API giả: trả lưới theo từng loại phòng và đếm số byte đã trả (NFR-PERF-05). */
function mockGrid(page: Page) {
  const state: { bytes: number; requests: string[] } = { bytes: 0, requests: [] };
  page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  page.route(ROOM_TYPES, (route) => fulfillJson(route, 200, listBody(TYPES)));
  page.route(GRID, async (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    state.requests.push(`${from} ${to}`);
    const grids=TYPES.map(type=>gridBody(type.id,from,to,type.id==='rt1'?6:type.id==='rt2'?-2:0,type.id==='rt3'?2:0));
    const body=JSON.stringify({...grids[0],grids,capturedAt:'2026-10-13T00:00:00.000Z'});
    state.bytes += Buffer.byteLength(body, 'utf8');
    await fulfillJson(route, 200, body);
  });
  return state;
}

test.describe('SCR-24 lưới tồn phòng theo ngày (HB-041)', () => {
  test('hiện lưới kèm ký hiệu trạng thái và tồn công bố', async ({ page }) => {
    mockGrid(page);
    await page.goto('/inventory-grid');
    const grid = page.getByTestId('inventory-grid');
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('rowheader', { name: 'DLX' })).toBeVisible();
    // pool 6 → còn bán; pool −2 → quá tải và tồn công bố 0; pool 0 + blocked 2 → khoá phòng.
    await expect(page.locator('[data-cell="0-0"]')).toHaveText('· 6');
    await expect(page.locator('[data-cell="1-0"]')).toHaveAttribute('data-status', 'oversold');
    await expect(page.locator('[data-cell="1-0"]')).toHaveText('! 0');
    await expect(page.locator('[data-cell="2-0"]')).toHaveAttribute('data-status', 'blocked');
    await expect(page.getByTestId('grid-legend')).toContainText('Quá tải');
  });

  test('điều hướng ô bằng bàn phím', async ({ page }) => {
    mockGrid(page);
    await page.goto('/inventory-grid');
    await expect(page.getByTestId('inventory-grid')).toBeVisible();
    await page.locator('[data-cell="0-0"]').click();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-cell="0-1"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-cell="1-1"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('[data-cell="1-0"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('[data-cell="1-6"]')).toBeFocused();
  });

  test('đổi khoảng ngày chỉ tải lại dữ liệu, không nạp lại trang', async ({ page }) => {
    const state = mockGrid(page);
    await page.goto('/inventory-grid');
    await expect(page.getByTestId('grid-updated')).toBeVisible();
    await page.getByLabel('Từ ngày').fill('2026-11-01');
    await page.getByLabel('Đến ngày').fill('2026-11-03');
    await page.getByRole('button', { name: 'Tải lưới' }).click();
    await expect(page.getByTestId('grid-updated')).toContainText('2026-11-01 → 2026-11-03');
    // Ô phải mang ngày của khoảng mới ⇒ dữ liệu đã được tải lại cho đúng khoảng.
    await expect(page.locator('[data-cell="0-0"]')).toHaveAttribute('aria-label', /2026-11-01/);
    expect(state.requests.at(-1)).toContain('2026-11-01');
    expect(state.requests.at(-1)).toContain('2026-11-03');
    expect(page.url()).toContain('/inventory-grid');
    expect(page.url()).not.toContain('2026-11-01');
  });

  test('tổng payload lưới 31 ngày × 3 loại phòng ≤ 200 KB (NFR-PERF-05)', async ({ page }) => {
    const state = mockGrid(page);
    await page.goto('/inventory-grid');
    await expect(page.getByTestId('inventory-grid')).toBeVisible();
    state.bytes = 0;
    state.requests.length = 0;
    await page.getByLabel('Từ ngày').fill('2026-11-01');
    await page.getByLabel('Đến ngày').fill('2026-12-01');
    await page.getByRole('button', { name: 'Tải lưới' }).click();
    await expect(page.getByTestId('grid-updated')).toContainText('2026-12-01');
    await expect(page.locator('[data-cell="0-0"]')).toHaveAttribute('aria-label', /2026-11-01/);
    // One server snapshot contains every type; no per-type capture drift.
    expect(state.requests).toHaveLength(1);
    expect(state.bytes).toBeLessThanOrEqual(200 * 1024);
  });

  test('khoảng quá 31 ngày thì cảnh báo và không gọi API', async ({ page }) => {
    const state = mockGrid(page);
    await page.goto('/inventory-grid');
    await expect(page.getByTestId('inventory-grid')).toBeVisible();
    await page.getByLabel('Từ ngày').fill('2026-11-01');
    await page.getByLabel('Đến ngày').fill('2026-12-15');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Khoảng tối đa 31 ngày' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Tải lưới' }).click();
    await expect(page.getByText('to: RANGE_INVALID')).toBeVisible();
    // Không có lời gọi nào mang khoảng quá dài.
    expect(state.requests.filter((request) => request.includes('2026-12-15'))).toEqual([]);
  });

  test('403 khi đọc thì hiện thiếu quyền, không lộ lưới', async ({ page }) => {
    page.route(PROPERTIES, (route) =>
      fulfillJson(route, 403, errorBody('E_AUTH_OUT_OF_SCOPE', 'trace-403', '/api/v1/properties')),
    );
    await page.goto('/inventory-grid');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('inventory-grid')).toHaveCount(0);
  });

  test('lưới không có vi phạm axe serious/critical và không cuộn ngang ở 360 px', async ({ page }) => {
    mockGrid(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/inventory-grid');
    await expect(page.getByTestId('inventory-grid')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });
});
test('stale date request cannot replace newest selected range',async({page})=>{
 mockGrid(page);await page.goto('/inventory-grid');await expect(page.getByTestId('inventory-grid')).toBeVisible();let release=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});
 await page.route(GRID,async route=>{const url=new URL(route.request().url());const from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??'';if(from==='2026-11-01')await wait;const grids=TYPES.map(type=>gridBody(type.id,from,to,from==='2026-12-01'?9:1));await fulfillJson(route,200,JSON.stringify({...grids[0],grids}));});
 await page.getByLabel('Từ ngày').fill('2026-11-01');await page.getByLabel('Đến ngày').fill('2026-11-03');await page.getByRole('button',{name:'Tải lưới'}).click();await page.getByLabel('Từ ngày').fill('2026-12-01');await page.getByLabel('Đến ngày').fill('2026-12-03');await page.getByRole('button',{name:'Tải lưới'}).click();await expect(page.getByTestId('grid-updated')).toContainText('2026-12-01');await expect(page.locator('[data-cell="0-0"]')).toHaveText('· 9');release();await expect(page.getByTestId('grid-updated')).toContainText('2026-12-01');
});
test('403 after cached grid removes cells and scope catalogue',async({page})=>{
 mockGrid(page);await page.goto('/inventory-grid');await expect(page.getByTestId('inventory-grid')).toBeVisible();await page.route(GRID,route=>fulfillJson(route,403,errorBody('E_AUTH_OUT_OF_SCOPE','synthetic403','/inventory/grid')));await page.getByRole('button',{name:'Tải lưới'}).click();await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();await expect(page.getByTestId('inventory-grid')).toHaveCount(0);await expect(page.getByLabel('Cơ sở').locator('option')).toHaveCount(0);
});
test('actual staff BFF logout from another tab immediately clears grid',async({page})=>{
 mockGrid(page);await page.goto('/inventory-grid');await expect(page.getByTestId('inventory-grid')).toBeVisible();const other=await page.context().newPage();await logoutCollectionStaff(other);await expect(page.getByTestId('inventory-grid')).toHaveCount(0);await expect(page.getByText('Phiên đã hết hạn. Đăng nhập lại để xem lưới tồn.')).toBeVisible();await expect(page.getByLabel('Cơ sở').locator('option')).toHaveCount(0);await other.close();
});
