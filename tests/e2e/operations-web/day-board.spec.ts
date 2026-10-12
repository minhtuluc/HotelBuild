import AxeBuilder from '@axe-core/playwright';
import {expect,test,type Page} from '@playwright/test';
import { fulfillJson,listBody,errorBody } from './fake-api';
import { operationsWebOnly } from './guard';
import { loginCollectionStaff } from './collect-fixture';

const property={id:'p1',name:'Pine Hill synthetic',status:'ACTIVE',activeRoomCount:20,overbookLimitPct:5,checkInTime:'14:00',checkOutTime:'12:00',version:1};
const type={id:'rt1',propertyId:'p1',code:'DOR',capacityAdults:6,capacityChildren:0,basePrice:200000,minPrice:100000,maxPrice:400000,allowShared:true,bedCount:6,version:1};
operationsWebOnly();
async function fixture(page:Page) {
  await loginCollectionStaff(page);
  await page.route('**/api/v1/properties',route=>fulfillJson(route,200,listBody([property])));
  await page.route('**/api/v1/room-types*',route=>fulfillJson(route,200,listBody([type])));
  const requests:string[]=[];
  await page.route('**/api/v1/inventory/grid*',async route=>{
    const url=new URL(route.request().url());const date=url.searchParams.get('from') ?? '';requests.push(date);
    await fulfillJson(route,200,JSON.stringify({propertyId:'p1',roomTypeId:'rt1',from:date,to:date,capturedAt:'2026-10-12T00:00:00.000Z',
      cells:[{date,supply:6,demand:2,pool:4,blocked:0,published:3}]}));
  });
  return requests;
}
test('hiện bảng tồn của ngày và mốc cập nhật máy chủ theo giờ VN',async({page})=>{
  await fixture(page);await page.goto('/day-board');
  await expect(page.getByRole('heading',{name:'Bảng điều khiển ngày'})).toBeVisible();
  await expect(page.getByTestId('day-row-rt1')).toContainText('3');
  await expect(page.getByTestId('day-row-rt1')).toContainText('Giường');
  await expect(page.getByTestId('day-captured')).toContainText('12/10/2026 07:00 (giờ VN)');
});
test('đổi ngày tải dữ liệu đúng ngày mà không nạp lại trang',async({page})=>{
  const requests=await fixture(page);await page.goto('/day-board');await expect(page.getByTestId('day-row-rt1')).toBeVisible();
  const stamp=await page.evaluate(()=>performance.timeOrigin);
  await page.getByLabel('Ngày đang xem').fill('2026-12-24');await page.getByRole('button',{name:'Xem ngày',exact:true}).click();
  await expect(page.getByTestId('day-displayed')).toContainText('2026-12-24');
  expect(requests).toContain('2026-12-24');expect(await page.evaluate(()=>performance.timeOrigin)).toBe(stamp);
});
test('403 che toàn bộ số liệu cũ',async({page})=>{
  await fixture(page);await page.goto('/day-board');await expect(page.getByTestId('day-row-rt1')).toBeVisible();
  await page.route('**/api/v1/inventory/grid*',route=>fulfillJson(route,403,errorBody('E_AUTH_OUT_OF_SCOPE','synthetic','/api/v1/inventory/grid')));
  await page.getByRole('button',{name:'Xem ngày',exact:true}).click();await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible();
  await expect(page.getByTestId('day-row-rt1')).toHaveCount(0);await expect(page.getByTestId('day-captured')).toHaveCount(0);
});
test('lỗi mạng giữ số liệu ngày đã tải và mốc cũ, không giả empty',async({page})=>{
  await fixture(page);await page.goto('/day-board');await expect(page.getByTestId('day-row-rt1')).toBeVisible();
  await page.route('**/api/v1/inventory/grid*',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Xem ngày',exact:true}).click();await expect(page.getByTestId('screen-alert')).toBeVisible();
  await expect(page.getByTestId('day-row-rt1')).toContainText('3');await expect(page.getByTestId('day-captured')).toContainText('07:00');
  await expect(page.getByText('Chưa có dữ liệu',{exact:true})).toHaveCount(0);
});
test('liên kết nhanh và phần chưa hỗ trợ có lý do, không giả số 0',async({page})=>{
  await fixture(page);await page.goto('/day-board');await expect(page.getByTestId('day-row-rt1')).toBeVisible();
  for (const [name,href] of [['Lưới tồn','/inventory-grid'],['Allotment theo kênh','/channel-allotments'],['Khoá phòng','/room-blocks']] as const)
    await expect(page.getByRole('link',{name,exact:true})).toHaveAttribute('href',href);
  await expect(page.getByTestId('day-unsupported')).toContainText('Đến / đi / ở: chưa hỗ trợ');
  await expect(page.getByTestId('day-unsupported')).toContainText('Ca quá tải: chưa hỗ trợ');
  await expect(page.getByTestId('day-unsupported')).toContainText('Kênh suy giảm đồng bộ: chưa hỗ trợ');
});
test('bàn phím, axe và 360px không cuộn ngang',async({page})=>{
  await fixture(page);await page.setViewportSize({width:360,height:800});await page.goto('/day-board');
  await expect(page.getByTestId('day-row-rt1')).toBeVisible();await page.getByLabel('Ngày đang xem').focus();
  for (let step=1;step<=4;step++) {
    await page.keyboard.press('Tab');
    const focused=await page.evaluate(()=>document.activeElement?.getAttribute('name'));
    expect(['date','propertyId']).toContain(focused);
    if(focused==='propertyId')break;
  }
  await expect(page.getByLabel('Cơ sở',{exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Xem ngày',exact:true})).toBeFocused();
  expect((await page.getByRole('button',{name:'Xem ngày',exact:true}).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByLabel('Cơ sở',{exact:true}).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>['serious','critical'].includes(v.impact ?? ''))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/hb040-day-board-360.png',fullPage:true});
});
