import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { errorBody, fulfillJson, listBody } from './fake-api';
import { operationsWebOnly } from './guard';
import {loginRefundStaff} from './refund-fixture';

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

const LIST = '**/api/session/sys/properties?*';
const PATCH = '**/api/session/sys/properties/p1';

operationsWebOnly();
test.beforeEach(async({page,request})=>{await loginRefundStaff(page,request,'OWNER');});

test.describe('SCR-19 cơ sở trên API giả (HB-037)', () => {
  test('hiện danh sách cơ sở', async ({ page }) => {
    await page.route(LIST, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.goto('/properties');
    const table = page.getByTestId('properties-table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('cell', { name: PROPERTY.name })).toBeVisible();
    await expect(table).toContainText('5');
    await expect(table).toContainText('14:00 / 12:00');
  });

  test('lưu cơ sở gửi If-Match, lý do và hiện phiên bản mới', async ({ page }) => {
    let seenIfMatch: string | undefined;
    let seenBody = '';
    await page.route(LIST, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(PATCH, async (route) => {
      seenIfMatch = route.request().headers()['if-match'];
      seenBody = route.request().postData() ?? '';
      await fulfillJson(route, 200, JSON.stringify({ ...PROPERTY, version: 4, overbookLimitPct: 8 }));
    });
    await page.goto('/properties');
    await page.getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Trần bán vượt (%)').fill('8');
    await page.getByLabel('Lý do thay đổi').fill('Nâng trần dịp cao điểm');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByTestId('save-success')).toContainText('phiên bản 4');
    expect(seenIfMatch).toBe('"3"');
    expect(seenBody).toContain('Nâng trần dịp cao điểm');
    expect(seenBody).toContain('"overbookLimitPct":8');
  });

  test('thiếu lý do thì không gọi API', async ({ page }) => {
    let patchCalls = 0;
    await page.route(LIST, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(PATCH, async (route) => {
      patchCalls += 1;
      await fulfillJson(route, 200, JSON.stringify(PROPERTY));
    });
    await page.goto('/properties');
    await page.getByRole('button', { name: 'Sửa' }).click();
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Vui lòng sửa 1 trường được đánh dấu')).toBeVisible();
    await expect(page.getByText('reason: REQUIRED')).toBeVisible();
    expect(patchCalls).toBe(0);
  });

  test('412 hiện xung đột, không tự ghi đè', async ({ page }) => {
    await page.route(LIST, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(PATCH, (route) =>
      fulfillJson(route, 412, errorBody('E_GEN_VERSION_CONFLICT', 'trace-412', '/api/v1/properties/p1')),
    );
    await page.goto('/properties');
    await page.getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Lý do thay đổi').fill('Đổi giờ trả phòng');
    await page.getByRole('button', { name: 'Lưu' }).click();
    const conflict = page.getByText(/Dữ liệu đã thay đổi/);
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('3');
    await expect(page.getByRole('button', { name: 'Tải lại và so sánh' })).toBeVisible();
  });

  test('403 khi đọc hiện thiếu quyền và không lộ dữ liệu', async ({ page }) => {
    await page.route(LIST, (route) =>
      fulfillJson(route, 403, errorBody('E_AUTH_OUT_OF_SCOPE', 'trace-403', '/api/v1/properties')),
    );
    await page.goto('/properties');
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
    await expect(page.getByTestId('properties-table')).toHaveCount(0);
  });

  test('mất mạng khi ghi là chưa xác định kết quả, không báo thất bại chắc chắn', async ({ page }) => {
    await page.route(LIST, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.route(PATCH, (route) => route.abort('failed'));
    await page.goto('/properties');
    await page.getByRole('button', { name: 'Sửa' }).click();
    await page.getByLabel('Lý do thay đổi').fill('Bảo trì định kỳ');
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText(/Chưa xác định kết quả/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tra cứu kết quả' })).toBeVisible();
  });

  test('không cuộn ngang ở 360 px (NFR-USE-04)', async ({ page }) => {
    await page.route(LIST, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/properties');
    await expect(page.getByTestId('properties-table')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('danh sách không có vi phạm axe serious/critical', async ({ page }) => {
    await page.route(LIST, (route) => fulfillJson(route, 200, listBody([PROPERTY])));
    await page.goto('/properties');
    await expect(page.getByTestId('properties-table')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking.map((violation) => violation.id)).toEqual([]);
  });
});

test('OWNER unknown survives reload; lookup is not proof and only exact key/body/version replay resolves',async({page})=>{
 let current=PROPERTY;const attempts:{key:string|undefined;tag:string|undefined;body:string}[]=[];
 await page.route(LIST,r=>fulfillJson(r,200,listBody([current])));
 await page.route(PATCH,async r=>{attempts.push({key:r.request().headers()['idempotency-key'],tag:r.request().headers()['if-match'],body:r.request().postData()??''});current={...PROPERTY,version:4};if(attempts.length===1)return r.abort('failed');return fulfillJson(r,200,JSON.stringify(current));});
 await page.goto('/properties');await page.getByRole('button',{name:'Sửa',exact:true}).click();await page.getByLabel('Lý do thay đổi').fill('  Original reason  ');await page.getByRole('button',{name:'Lưu',exact:true}).click();await expect(page.getByTestId('admin-unknown')).toBeVisible();
 await page.reload();await expect(page.getByTestId('admin-unknown')).toBeVisible();await expect(page.getByRole('button',{name:'Sửa',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Tra cứu kết quả',exact:true}).click();await expect(page.getByTestId('admin-unknown')).toBeVisible();expect(attempts).toHaveLength(1);
 await page.getByRole('button',{name:'Gửi lại đúng yêu cầu',exact:true}).click();await expect(page.getByTestId('save-success')).toContainText('phiên bản 4');expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);expect(JSON.parse(attempts[0]!.body).reason).toBe('  Original reason  ');
});

test('412 compare/adopt retains user delta and does not overwrite colleague fields',async({page})=>{
 let current=PROPERTY;const bodies:unknown[]=[];const tags:(string|undefined)[]=[];
 await page.route(LIST,r=>fulfillJson(r,200,listBody([current])));
 await page.route(PATCH,async r=>{const body=JSON.parse(r.request().postData()??'{}');bodies.push(body);tags.push(r.request().headers()['if-match']);if(bodies.length===1){current={...PROPERTY,version:4,checkOutTime:'11:00'};return fulfillJson(r,412,errorBody('E_GEN_VERSION_CONFLICT','conflict','/properties/p1'));}current={...current,...body,version:5};return fulfillJson(r,200,JSON.stringify(current));});
 await page.goto('/properties');await page.getByRole('button',{name:'Sửa',exact:true}).click();await page.getByLabel('Tên cơ sở').fill('Edited name');await page.getByLabel('Lý do thay đổi').fill('Keep my delta');await page.getByRole('button',{name:'Lưu',exact:true}).click();await expect(page.getByTestId('admin-conflict')).toBeVisible();await expect(page.getByLabel('Tên cơ sở')).toHaveValue('Edited name');
 await page.getByRole('button',{name:'Tải lại và so sánh',exact:true}).click();await expect(page.getByTestId('admin-comparison')).toContainText('4');await page.getByRole('button',{name:'Dùng phiên bản hiện tại để lưu bản nhập',exact:true}).click();await page.getByRole('button',{name:'Lưu',exact:true}).click();await expect(page.getByTestId('save-success')).toContainText('5');expect(tags).toEqual(['"3"','"4"']);expect(bodies[1]).toEqual({name:'Edited name',reason:'Keep my delta'});await expect(page.getByTestId('properties-table')).toContainText('11:00');
});

test('same OWNER token rotation preserves conflict draft and allows explicit adoption',async({page})=>{
 let current=PROPERTY;let writes=0;
 await page.route(LIST,r=>fulfillJson(r,200,listBody([current])));
 await page.route(PATCH,async r=>{writes++;if(writes===1){current={...PROPERTY,version:4};return fulfillJson(r,412,errorBody('E_GEN_VERSION_CONFLICT','conflict','/properties/p1'));}current={...current,name:'Keep across refresh',version:5};return fulfillJson(r,200,JSON.stringify(current));});
 await page.goto('/properties');await page.getByRole('button',{name:'Sửa',exact:true}).click();await page.getByLabel('Tên cơ sở').fill('Keep across refresh');await page.getByLabel('Lý do thay đổi').fill('Original edit');await page.getByRole('button',{name:'Lưu',exact:true}).click();await expect(page.getByTestId('admin-conflict')).toBeVisible();
 const other=await page.context().newPage();await other.goto('/');
 await other.evaluate(async(origin)=>{const module:typeof import('../../../packages/web-session/src/client.js')=await import(origin+'/__test/session-client.js');const client=module.createSessionClient({kind:'staff'});try{const token=await client.getAccessToken();if(!token)throw Error('No fixture session');if(!await client.onUnauthorized(token))throw Error('Rotation failed');}finally{client.dispose();}},new URL(process.env.E2E_API_BASE_URL??'http://127.0.0.1:4000/api/v1').origin);
 await expect(page.getByTestId('admin-comparison')).toBeVisible();await expect(page.getByLabel('Tên cơ sở')).toHaveValue('Keep across refresh');await page.getByRole('button',{name:'Dùng phiên bản hiện tại để lưu bản nhập',exact:true}).click();await page.getByRole('button',{name:'Lưu',exact:true}).click();await expect(page.getByTestId('save-success')).toContainText('5');expect(writes).toBe(2);await other.close();
});
