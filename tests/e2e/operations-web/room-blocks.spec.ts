import { expect, test, type Page } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';
import { loginRefundStaff } from './refund-fixture';

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

const ROOM = {
  id: 'r1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  code: '101',
  floor: 1,
  status: 'ACTIVE',
  connectingRoomId: null,
  version: 1,
};

const BLOCK = {
  id: 'bl1',
  roomId: 'r1',
  startDate: '2026-12-20',
  endDate: '2026-12-22',
  reason: 'MAINTENANCE',
  note: 'Thay bóng đèn',
};

const PROPERTIES = '**/api/session/sys/properties?*';
const ROOMS = '**/api/session/sys/rooms?*';
const BLOCKS = '**/api/session/sys/room-blocks**';

operationsWebOnly();
test.beforeEach(async ({ page, request }) => { await loginRefundStaff(page, request, 'MANAGER'); });

function backend(
  page: Page,
  blocks: readonly unknown[] = [BLOCK],
): { created: () => string[]; deleted: () => string[] } {
  const created: string[] = [];
  const deleted: string[] = [];
  let current = [...blocks];
  void page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
  void page.route(ROOMS, (route) => fulfillJson(route, 200, listBody([ROOM])));
  void page.route(BLOCKS, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      created.push(request.postData() ?? '');
      const body = request.postDataJSON();
      const row = { ...body, id: 'new-block', note: body.note ?? null };
      current.push(row);
      return fulfillJson(route, 201, JSON.stringify(row));
    }
    if (request.method() === 'DELETE') {
      deleted.push(request.url());
      current = current.filter(row => !(typeof row === 'object' && row !== null && 'id' in row && row.id === request.url().split('?')[0]?.split('/').at(-1)));
      return fulfillJson(route, 204, '');
    }
    return fulfillJson(route, 200, listBody(current));
  });
  return { created: () => created, deleted: () => deleted };
}

test.describe('SCR-22 khoá phòng trên API giả (HB-039)', () => {
  test('hiện danh sách khoá phòng', async ({ page }) => {
    backend(page);
    await page.goto('/room-blocks');
    const table = page.getByTestId('room-blocks-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('101');
    await expect(table).toContainText('2026-12-20 → 2026-12-22');
    await expect(table).toContainText('Bảo trì');
    await expect(table).toContainText('(MAINTENANCE)');
    await expect(table).toContainText('Thay bóng đèn');
  });

  test('cảnh báo chồng lấn trước khi gửi', async ({ page }) => {
    backend(page);
    await page.goto('/room-blocks');
    await page.getByRole('combobox', { name: 'Phòng', exact: true }).selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-21');
    await page.getByLabel('Đến ngày').fill('2026-12-24');
    await expect(page.getByTestId('room-block-overlap')).toContainText('chồng lấn');
  });

  test('tạo khoá rồi đọc lại', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/room-blocks');
    await page.getByRole('combobox', { name: 'Phòng', exact: true }).selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-25');
    await page.getByLabel('Đến ngày').fill('2026-12-27');
    await page.getByLabel('Lý do').selectOption('RENOVATION');
    await page.getByLabel('Ghi chú').fill('Sửa điều hoà');
    await page.getByRole('button', { name: 'Tạo khoá' }).click();
    await expect(page.getByTestId('room-block-success')).toHaveText('Đã tạo khoá phòng.');
    await expect(page.getByTestId('room-blocks-table')).toBeVisible();
    expect(spy.created()).toHaveLength(1);
    expect(spy.created()[0]).toContain('"roomId":"r1"');
    expect(spy.created()[0]).toContain('"reason":"RENOVATION"');
    expect(spy.created()[0]).toContain('Sửa điều hoà');
  });

  test('ngày không hợp lệ thì không gọi API', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/room-blocks');
    await page.getByRole('combobox', { name: 'Phòng', exact: true }).selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-27');
    await page.getByLabel('Đến ngày').fill('2026-12-25');
    await page.getByRole('button', { name: 'Tạo khoá' }).click();
    await expect(page.getByText('Vui lòng sửa 1 trường được đánh dấu')).toBeVisible();
    expect(spy.created()).toHaveLength(0);
  });

  test('gỡ khoá kèm lý do', async ({ page }) => {
    const spy = backend(page);
    await page.goto('/room-blocks');
    await page.getByRole('button', { name: 'Gỡ khoá' }).click();
    await page.getByLabel('Lý do gỡ khoá').fill('Đã sửa xong');
    await page.getByRole('button', { name: 'Xác nhận gỡ' }).click();
    await expect(page.getByTestId('room-block-success')).toHaveText('Đã gỡ khoá phòng.');
    await expect(page.getByTestId('room-blocks-table')).toHaveCount(0);
    expect(spy.deleted()).toHaveLength(1);
    expect(decodeURIComponent((spy.deleted()[0] ?? '').replace(/\+/g, ' '))).toContain(
      'reason=Đã sửa xong',
    );
  });

  test('403 hiện thiếu quyền', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOMS, (route) => fulfillJson(route, 200, listBody([ROOM])));
    await page.route(BLOCKS, (route) =>
      fulfillJson(route, 403, errorBody('E_RBAC_FORBIDDEN', 'trace-403', '/api/v1/room-blocks')),
    );
    await page.goto('/room-blocks');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('room-blocks-table')).toHaveCount(0);
  });

  test('mất mạng khi tạo là chưa xác định kết quả', async ({ page }) => {
    await page.route(PROPERTIES, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(ROOMS, (route) => fulfillJson(route, 200, listBody([ROOM])));
    await page.route(BLOCKS, (route) => {
      if (route.request().method() === 'POST') return route.abort('failed');
      return fulfillJson(route, 200, listBody([BLOCK]));
    });
    await page.goto('/room-blocks');
    await page.getByRole('combobox', { name: 'Phòng', exact: true }).selectOption('r1');
    await page.getByLabel('Từ ngày').fill('2026-12-25');
    await page.getByLabel('Đến ngày').fill('2026-12-27');
    await page.getByRole('button', { name: 'Tạo khoá' }).click();
    await expect(page.getByText(/Chưa xác định kết quả/)).toBeVisible();
  });
});

test('half-open adjacent periods have no warning and equal-day sends no request', async ({ page }) => {
 const spy = backend(page); await page.goto('/room-blocks');
 await page.getByRole('combobox', { name: 'Phòng', exact:true }).selectOption('r1');
 await page.getByLabel('Từ ngày', {exact:true}).fill('2026-12-22');
 await page.getByLabel('Đến ngày', {exact:true}).fill('2026-12-24');
 await expect(page.getByTestId('room-block-overlap')).toHaveCount(0);
 await page.getByLabel('Đến ngày', {exact:true}).fill('2026-12-22');
 await page.getByRole('button', {name:'Tạo khoá',exact:true}).click();
 await expect(page.getByText('Vui lòng sửa 1 trường được đánh dấu')).toBeVisible();
 expect(spy.created()).toHaveLength(0);
});
test('FRONT_DESK may create but never sees removal; HOUSEKEEPING remains readonly', async ({page,request}) => {
 await loginRefundStaff(page,request,'FRONT_DESK'); backend(page); await page.goto('/room-blocks');
 await expect(page.getByTestId('room-block-form')).toBeVisible();
 await expect(page.getByRole('button',{name:'Gỡ khoá',exact:true})).toHaveCount(0);
 await loginRefundStaff(page,request,'HOUSEKEEPING'); await page.goto('/room-blocks');
 await expect(page.getByTestId('room-blocks-table')).toBeVisible();
 await expect(page.getByTestId('room-block-form')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Gỡ khoá',exact:true})).toHaveCount(0);
});
test('lost DELETE reload and empty GET remain unknown; manual replay keeps UUID and exact reason query', async ({page}) => {
 let deleted = false; const sent: {key:string|undefined,url:string}[] = [];
 await page.route(PROPERTIES,route=>fulfillJson(route,200,listBody([PROPERTY])));
 await page.route(ROOMS,route=>fulfillJson(route,200,listBody([ROOM])));
 await page.route(BLOCKS,route=>{
  if(route.request().method()==='DELETE') {
   sent.push({key:route.request().headers()['idempotency-key'],url:route.request().url()}); deleted=true;
   return sent.length === 1 ? route.abort('failed') : route.fulfill({ status: 204, headers: {'idempotency-replayed':'true'}, body:'' });
  }
  return fulfillJson(route,200,listBody(deleted?[]:[BLOCK]));
 });
 await page.goto('/room-blocks'); await page.getByRole('button',{name:'Gỡ khoá',exact:true}).click();
 await page.getByLabel('Lý do gỡ khoá',{exact:true}).fill('Synthetic repaired & checked');
 await page.getByRole('button',{name:'Xác nhận gỡ',exact:true}).click();
 await expect(page.getByTestId('admin-unknown')).toBeVisible(); await page.reload();
 await expect(page.getByTestId('admin-unknown')).toContainText(sent[0]!.key!);
 await page.getByRole('button',{name:'Tra cứu kết quả',exact:true}).click();
 await expect(page.getByTestId('admin-unknown')).toBeVisible(); expect(sent).toHaveLength(1);
 await expect(page.getByRole('button',{name:'Tạo khoá',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Gửi lại đúng yêu cầu',exact:true}).click();
 await expect(page.getByTestId('room-block-success')).toHaveText('Đã gỡ khoá phòng.');
 expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
 await expect(page.getByTestId('admin-unknown')).toHaveCount(0);
});
test('validation400 preserves filled creation fields and removal reason', async({page})=>{
 backend(page);
 await page.route(BLOCKS,route=>route.request().method()==='GET'?fulfillJson(route,200,listBody([BLOCK])):fulfillJson(route,400,JSON.stringify({code:'E_GEN_VALIDATION_FAILED',message:'invalid',traceId:'synthetic',timestamp:'2026-10-13T00:00:00Z',path:'/room-blocks',details:[{field:'reason',issue:'INVALID'}]})));
 await page.goto('/room-blocks');
 await page.getByRole('combobox',{name:'Phòng',exact:true}).selectOption('r1');
 await page.getByLabel('Từ ngày',{exact:true}).fill('2026-12-25'); await page.getByLabel('Đến ngày',{exact:true}).fill('2026-12-27');
 await page.getByLabel('Ghi chú',{exact:true}).fill('Synthetic repair note'); await page.getByRole('button',{name:'Tạo khoá',exact:true}).click();
 await expect(page.getByText('Vui lòng sửa 1 trường được đánh dấu')).toBeVisible(); await expect(page.getByLabel('Ghi chú',{exact:true})).toHaveValue('Synthetic repair note');
 await page.getByRole('button',{name:'Gỡ khoá',exact:true}).click(); await page.getByLabel('Lý do gỡ khoá',{exact:true}).fill('Synthetic repair reason');
 await page.getByRole('button',{name:'Xác nhận gỡ',exact:true}).click(); await expect(page.getByLabel('Lý do gỡ khoá',{exact:true})).toHaveValue('Synthetic repair reason');
});

test('lost POST preserves exact UUID/body after reload and prevents a fresh command until replay', async ({page}) => {
 const sent: {key:string|undefined,body:string|null}[]=[]; let created=false;
 await page.route(PROPERTIES,route=>fulfillJson(route,200,listBody([PROPERTY])));
 await page.route(ROOMS,route=>fulfillJson(route,200,listBody([ROOM])));
 await page.route(BLOCKS,route=>{
  const body={ roomId:'r1',startDate:'2026-12-25',endDate:'2026-12-27',reason:'MAINTENANCE',note:'Synthetic repair' };
  const row={...body,id:'new-block'};
  if(route.request().method()==='POST') {
   sent.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});created=true;
   return sent.length===1?route.abort('failed'):fulfillJson(route,201,JSON.stringify(row));
  }
  return fulfillJson(route,200,listBody(created?[row]:[]));
 });
 await page.goto('/room-blocks');
 await page.getByRole('combobox',{name:'Phòng',exact:true}).selectOption('r1');
 await page.getByLabel('Từ ngày',{exact:true}).fill('2026-12-25'); await page.getByLabel('Đến ngày',{exact:true}).fill('2026-12-27'); await page.getByLabel('Ghi chú',{exact:true}).fill('Synthetic repair');
 await page.getByRole('button',{name:'Tạo khoá',exact:true}).click(); await expect(page.getByTestId('admin-unknown')).toBeVisible();
 await page.reload();await expect(page.getByTestId('admin-unknown')).toContainText(sent[0]!.key!);
 await page.getByRole('button',{name:'Tra cứu kết quả',exact:true}).click();await expect(page.getByTestId('admin-unknown')).toBeVisible();expect(sent).toHaveLength(1);
 await expect(page.getByRole('button',{name:'Tạo khoá',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Gửi lại đúng yêu cầu',exact:true}).click();await expect(page.getByTestId('room-block-success')).toHaveText('Đã tạo khoá phòng.');
 expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);
});
