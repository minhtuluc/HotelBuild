import { randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ApiClient, createBookingApi, createQuoteApi, createPaymentApi } from '../../packages/api-client/src/index.js';
import { quoteInput, bookingInput } from '../../packages/web-session/test/journey-fixtures.js';
import type { createSessionClient } from '../../packages/web-session/src/client.js';
const baseUrl=process.env.E2E_API_BASE_URL??'http://127.0.0.1:4000/api/v1';
const origin=new URL(baseUrl).origin;
test.beforeEach(({},info)=>test.skip(!info.project.name.startsWith('customer-web'),'SCR06 belongs to customer web'));
async function fixture(page:Page){
 await page.goto('/');
 await page.evaluate(async({url,phone})=>{
  const module:{createSessionClient:typeof createSessionClient}=await import(url);
  window.sessionClient=module.createSessionClient({kind:'guest'});
  await window.sessionClient.login({phone,password:'Synthetic-password'});
  return (await window.sessionClient.getAccessToken())!;
 },{url:origin+'/__test/session-client.js',phone:`+84${String(randomInt(1000000000)).padStart(9,'0')}`});
 const getToken=()=>page.evaluate(async url=>{
  const module:{createSessionClient:typeof createSessionClient}=await import(url);
  const session=module.createSessionClient({kind:'guest'});
  try{return (await session.getAccessToken())!;}finally{session.dispose();}
 },origin+'/__test/session-client.js');
 const client=new ApiClient({baseUrl,getAccessToken:getToken,maxAttempts:1});
 const quote=(await createQuoteApi(client).quote({...quoteInput,propertyId:'journey-standard'})).data;
 const booking=(await createBookingApi(client).create({...bookingInput,propertyId:'journey-standard',quoteId:quote.quoteId})).data;
 return {booking,client,async control(event:string,paymentId?:string){
  const r=await fetch(origin+`/__control/f5/bookings/${booking.id}`,{method:'POST',headers:{authorization:`Bearer ${await getToken()}`,'content-type':'application/json'},body:JSON.stringify({event,...(paymentId?{paymentId}:{})})});expect(r.status).toBe(200);
 }};
}
async function axe(page:Page){const result=await new AxeBuilder({page}).analyze();expect(result.violations.filter(v=>['serious','critical'].includes(v.impact??''))).toEqual([]);}
test('SCR06 opens from the existing booking journey and shows the server deposit',async({page})=>{
 const f=await fixture(page);await page.goto(`/booking/${f.booking.id}/pay`);
 await expect(page.getByRole('heading',{name:'Thanh toán tiền cọc',exact:true})).toBeVisible();
 await expect(page.getByTestId('approved-deposit')).toContainText('300.000');
 await expect(page.getByRole('radio',{name:'VNPay',exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/hb101-ready.png',fullPage:true});
 await axe(page);
});
async function start(page:Page,id:string,method:'VNPay'|'MoMo'){
 await page.goto(`/booking/${id}/pay`);await page.getByRole('radio',{name:method,exact:true}).check();
 await page.getByRole('button',{name:'Xem lại trước khi thanh toán',exact:true}).click();
 await expect(page.getByRole('button',{name:'Xác nhận và mở cổng thanh toán',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Xác nhận và mở cổng thanh toán',exact:true}).click();
 await page.waitForURL(origin+'/__test/f5/payments/*');
 const paymentId=page.url().split('/').at(-1)!;
 await page.goto(`/booking/${id}/pay?paymentId=${paymentId}`);
 await expect(page.getByTestId('payment-result')).toBeVisible();return paymentId;
}
for(const method of ['VNPay','MoMo'] as const) test(`${method}: redirect result is not payment evidence; callback alone confirms`,async({page})=>{
 const f=await fixture(page);const id=await start(page,f.booking.id,method);
 await page.goto(`/booking/${f.booking.id}/pay?result=success&paymentId=${id}`);
 await expect(page.getByTestId('payment-result')).toContainText('Chưa có xác nhận');
 await expect(page.getByTestId('server-booking-status')).toHaveText('HELD');
 expect((await createPaymentApi(f.client).balance(f.booking.id)).data.paidAmount).toBe(0);
 await f.control('payment-success',id);await page.getByRole('button',{name:'Kiểm tra giao dịch',exact:true}).click();
 await expect(page.getByTestId('payment-result')).toContainText('Máy chủ đã xác nhận');
 await expect(page.getByTestId('server-booking-status')).toHaveText('CONFIRMED');
 await axe(page);
});
for(const event of ['expire','cancel','no-show'])test(`late callback after ${event} never resurrects booking`,async({page})=>{
 const f=await fixture(page);const id=await start(page,f.booking.id,'MoMo');
 await f.control('payment-timeout',id);await f.control(event);await f.control('payment-success',id);
 await page.goto(`/booking/${f.booking.id}/pay?paymentId=${id}&result=success`);
 await expect(page.getByTestId('payment-result')).toContainText('Đã nhận tiền, đang xử lý');
 await expect(page.getByTestId('server-booking-status')).toHaveText(event==='expire'?'EXPIRED':event==='cancel'?'CANCELLED':'NO_SHOW');
 await expect(page.getByRole('button',{name:'Xem lại trước khi thanh toán'})).toHaveCount(0);
 await axe(page);
});
test('server amount changes between two steps: no POST before reconfirmation; partial VND not recomputed by UI',async({page})=>{
 const f=await fixture(page);await page.goto(`/booking/${f.booking.id}/pay`);
 await page.getByRole('radio',{name:'VNPay',exact:true}).check();await page.getByRole('button',{name:'Xem lại trước khi thanh toán',exact:true}).click();
 await expect(page.getByRole('button',{name:'Xác nhận và mở cổng thanh toán',exact:true})).toBeVisible();
 await f.control('unconfirmed-partial');
 await page.getByRole('button',{name:'Xác nhận và mở cổng thanh toán',exact:true}).click();
 await expect(page.getByTestId('payment-screen')).toHaveAttribute('data-phase','confirm');
 await expect(page.getByTestId('approved-deposit')).toContainText('49.501');
 expect((await createBookingApi(f.client).get(f.booking.id)).data.payments?.filter(p=>p.method==='VNPAY')).toEqual([]);
 await axe(page);
 await page.getByRole('button',{name:/Tải lại/}).click();
 await page.getByRole('button',{name:'Xem lại trước khi thanh toán',exact:true}).click();
 await page.getByRole('button',{name:'Xác nhận và mở cổng thanh toán',exact:true}).click();
 await page.waitForURL(origin+'/__test/f5/payments/*');
 const id=page.url().split('/').at(-1)!;
 await page.goto(`/booking/${f.booking.id}/pay?paymentId=${id}`);
 expect((await createPaymentApi(f.client).status(id)).data.amount).toBe(49501);
});
test('lost POST response stays unknown and reload recovers the single real payment',async({page})=>{
 const f=await fixture(page);let posts=0;
 await page.route('**/api/session/journey/payments/online',async route=>{posts++;await route.fetch();await route.abort('failed');});
 await page.goto(`/booking/${f.booking.id}/pay`);await page.getByRole('radio',{name:'MoMo',exact:true}).check();
 await page.getByRole('button',{name:'Xem lại trước khi thanh toán',exact:true}).click();
 await page.getByRole('button',{name:'Xác nhận và mở cổng thanh toán',exact:true}).click();
 await expect(page.getByTestId('payment-screen')).toHaveAttribute('data-phase','unknown');await axe(page);
 await page.reload();await expect(page.getByTestId('payment-screen')).toHaveAttribute('data-phase','pending');
 expect(posts).toBe(1);expect((await createBookingApi(f.client).get(f.booking.id)).data.payments).toHaveLength(1);
 await expect(page.getByRole('button',{name:'Xem lại trước khi thanh toán'})).toHaveCount(0);
});
test('FAILED is read from server, hold survives, and late callback can still be checked',async({page})=>{
 const f=await fixture(page);const id=await start(page,f.booking.id,'VNPay');await f.control('payment-timeout',id);
 await page.goto(`/booking/${f.booking.id}/pay?paymentId=${id}`);
 await expect(page.getByTestId('payment-result')).toContainText('Giao dịch chưa thành công');
 await expect(page.getByTestId('server-booking-status')).toHaveText('HELD');
 await f.control('payment-success',id);await page.getByRole('button',{name:'Kiểm tra giao dịch',exact:true}).click();
 await expect(page.getByTestId('server-booking-status')).toHaveText('CONFIRMED');
});
test('validation, mobile keyboard, empty projection, expired hold, and forbidden expose no fake success',async({page})=>{
 const f=await fixture(page);await page.setViewportSize({width:360,height:800});await page.goto(`/booking/${f.booking.id}/pay`);
 await page.getByRole('button',{name:'Xem lại trước khi thanh toán',exact:true}).click();
 await expect(page.getByRole('button',{name:/method/})).toBeVisible();await axe(page);
 await page.getByRole('radio',{name:'MoMo',exact:true}).focus();await page.keyboard.press('Space');
 await expect(page.getByRole('radio',{name:'MoMo',exact:true})).toBeChecked();
 await page.screenshot({path:'/tmp/hb101-mobile.png',fullPage:true});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await f.control('cancel');await page.reload();await expect(page.getByTestId('payment-screen')).toHaveAttribute('data-phase','blocked');await axe(page);
 const other=await fixture(page);await other.control('hold-boundary');await page.goto(`/booking/${other.booking.id}/pay`);
 await expect(page.getByTestId('payment-screen')).toHaveAttribute('data-phase','blocked');await expect(page.getByText(/hết hạn lúc/)).toBeVisible();await axe(page);
 await page.goto(`/booking/${f.booking.id}/pay`);await expect(page.getByTestId('payment-screen')).toHaveAttribute('data-phase','forbidden');
 await expect(page.getByTestId('approved-deposit')).toHaveCount(0);await axe(page);
});
test('loading and refreshing show real HTTP wait; pending polling has a finite stop',async({page})=>{
 const f=await fixture(page);await page.clock.install();let release:()=>void=()=>{};let gate=new Promise<void>(r=>{release=r;});
 await page.route(`**/api/session/journey/bookings/${f.booking.id}`,async route=>{await gate;await route.continue();});
 await page.goto(`/booking/${f.booking.id}/pay`);await expect(page.getByTestId('payment-screen')).toHaveAttribute('data-phase','loading');await axe(page);
 release();await expect(page.getByTestId('approved-deposit')).toBeVisible();await page.unroute(`**/api/session/journey/bookings/${f.booking.id}`);
 const payment=(await createPaymentApi(f.client).createOnline({bookingId:f.booking.id,type:'DEPOSIT',method:'MOMO',amount:300000,returnUrl:'https://guest.test/return'})).data;
 await page.goto(`/booking/${f.booking.id}/pay?paymentId=${payment.paymentId}`);await expect(page.getByTestId('payment-result')).toBeVisible();
 gate=new Promise<void>(r=>{release=r;});await page.route(`**/api/session/journey/bookings/${f.booking.id}`,async route=>{await gate;await route.continue();});
 await page.getByRole('button',{name:'Kiểm tra giao dịch',exact:true}).click();
 await expect(page.getByText(/Cập nhật lúc/)).toBeVisible();await axe(page);release();
 await expect(page.getByRole('button',{name:'Kiểm tra giao dịch',exact:true})).toBeEnabled();
 await page.unrouteAll({behavior:'wait'});
 let reads=0;page.on('request',r=>{if(r.url().endsWith(`/payments/${payment.paymentId}/status`))reads++;});
 for(let i=0;i<14;i++){await page.clock.runFor(2100);await page.waitForTimeout(60);await expect(page.getByRole('button',{name:'Kiểm tra giao dịch',exact:true})).toBeEnabled();}
 const stopped=reads;await page.clock.runFor(30000);await page.waitForTimeout(150);expect(reads).toBe(stopped);expect(reads).toBe(12);
 await page.getByRole('button',{name:'Kiểm tra giao dịch',exact:true}).click();await expect.poll(()=>reads).toBe(stopped+1);
});
