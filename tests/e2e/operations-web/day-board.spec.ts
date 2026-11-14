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
  await page.route('**/api/v1/operations/day-board*',route=>{
    const url=new URL(route.request().url());const date=url.searchParams.get('date') ?? '';
    return fulfillJson(route,200,JSON.stringify(boardBody(date)));
  });
  return requests;
}
const guest=(code:string,status:string,patch:Record<string,unknown>={})=>({bookingId:`b-${code}`,code,guestName:`Khách ${code}`,roomTypeId:'rt1',roomCount:1,
  checkIn:'2026-10-12',checkOut:'2026-10-14',status,channelCode:'WEB',balanceDue:0,...patch});
function boardBody(date:string){
  return {propertyId:'p1',date,capturedAt:'2026-10-12T00:00:00.000Z',
    arrivals:{total:2,truncated:false,items:[guest('PH2','CHECKED_IN'),guest('PH1','CONFIRMED',{balanceDue:700000,roomCount:2})]},
    departures:{total:0,truncated:false,items:[]},
    inHouse:{total:250,truncated:true,items:[guest('PH9','CHECKED_IN')]},
    overbooking:{openFromDate:3,onDate:1},
    degradedChannels:[{channelId:'c1',code:'OTA_BOOKING',name:'Booking.com',consecutiveFailures:4,lastSyncAt:null}]};
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
test('liên kết nhanh và bảng ngày lấy số từ máy chủ, khách chưa nhận phòng lên đầu',async({page})=>{
  await fixture(page);await page.goto('/day-board');await expect(page.getByTestId('day-row-rt1')).toBeVisible();
  for (const [name,href] of [['Lưới tồn','/inventory-grid'],['Allotment theo kênh','/channel-allotments'],['Khoá phòng','/room-blocks']] as const)
    await expect(page.getByRole('navigation',{name:'Điều hướng nhanh'}).getByRole('link',{name,exact:true})).toHaveAttribute('href',href);
  await expect(page.getByTestId('day-unsupported')).toHaveCount(0);
  await expect(page.getByTestId('day-stat-arrivals')).toContainText('2');
  await expect(page.getByTestId('day-stat-arrivals')).toContainText('1 chưa làm thủ tục');
  await expect(page.getByTestId('day-stat-inHouse')).toContainText('250');
  await expect(page.getByTestId('day-stat-cases')).toContainText('3 ca mở từ ngày này');
  await expect(page.getByTestId('day-stat-cases')).toHaveAttribute('href','/overbooking/cases');
  const rows=page.getByTestId('day-group-arrivals').locator('tbody tr');
  await expect(rows.first()).toContainText('PH1');await expect(rows.first()).toContainText('DOR × 2');
  await expect(rows.first()).toContainText('700.000');
  await expect(page.getByTestId('day-booking-PH1').getByRole('link',{name:'PH1'})).toHaveAttribute('href','/bookings/b-PH1');
  await expect(page.getByTestId('day-group-departures')).toContainText('Không có khách trả phòng');
  await expect(page.getByTestId('day-truncated-inHouse')).toContainText('1/250');
  await expect(page.getByTestId('day-channel-OTA_BOOKING')).toContainText('chưa đồng bộ được lần nào');
});
test('403 ở bảng ngày chỉ ẩn danh sách khách, vẫn giữ tồn khả dụng',async({page})=>{
  await fixture(page);
  await page.route('**/api/v1/operations/day-board*',route=>fulfillJson(route,403,errorBody('E_RBAC_FORBIDDEN','synthetic','/api/v1/operations/day-board')));
  await page.goto('/day-board');
  await expect(page.getByTestId('day-row-rt1')).toContainText('3');
  await expect(page.getByTestId('day-board-error')).toContainText('Vai trò của bạn không xem được');
  await expect(page.getByTestId('day-stats')).toHaveCount(0);
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
