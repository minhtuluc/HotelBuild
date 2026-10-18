/**
 * HB-094 — adapter VNPay/MoMo **cùng hợp đồng** (AC4): đơn vị thuần (không CSDL), kiểm thuật toán
 * ký/đối chiếu theo đúng tài liệu provider (api.md §5.2) và bộ mô phỏng cùng hợp đồng.
 *
 * Mỗi ca tính chữ ký kỳ vọng **độc lập** bằng `node:crypto` ngay trong test, không nhờ mã sản phẩm.
 */
import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import { VnpayAdapter, vnpaySignableParams } from '../../src/modules/pay/psp/vnpay.js';
import { MomoAdapter } from '../../src/modules/pay/psp/momo.js';
import { signatureString } from '../../src/modules/pay/psp/signing.js';
import { allowedReturnUrl, pspSettings } from '../../src/modules/pay/psp/settings.js';
import { PspSimulator } from '../../src/modules/pay/psp/simulator.js';
import type { PspInitRequest } from '../../src/modules/pay/psp/port.js';
import type { ApiConfig } from '../../src/config/env.js';

const now = new Date('2026-10-09T00:14:02.000Z');
const orderRef = '018f1a2b-3c4d-4e5f-6a7b-8c9d0e1f2a3b';
const baseRequest: PspInitRequest = {
  orderRef,
  amount: 907000n,
  type: 'DEPOSIT',
  returnUrl: 'https://guest.app/booking/return',
  ipnUrl: 'https://api.app/api/v1/integrations/psp/vnpay/callback',
  now,
  ip: '203.0.113.9',
};

/** Kiểm thử mới cho phép bộ mô phỏng xác minh sự kiện (`PSP_ALLOW_MOCK`); thiếu cờ ⇒ fail closed. */
const MOCK_CONFIG: ApiConfig = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'x-access',
  JWT_REFRESH_SECRET: 'x-refresh',
  BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
  IDEMPOTENCY_TTL_HOURS: 24,
  LOG_LEVEL: 'error',
  HOST: '127.0.0.1',
  PORT: 0,
  PSP_ALLOW_MOCK: 'true',
};

const LIVE_CONFIG: ApiConfig = {
  ...MOCK_CONFIG,
  VNPAY_TMN_CODE: 'TESTVN',
  VNPAY_HASH_SECRET: 'vnp-secret-value',
  MOMO_PARTNER_CODE: 'MOMOTEST',
  MOMO_ACCESS_KEY: 'mom-access',
  MOMO_SECRET_KEY: 'mom-secret-value',
};

const settings = () => pspSettings(MOCK_CONFIG);
/** Chuỗi kỳ vọng độc lập: sắp xếp tham số (bỏ hai trường chữ ký) rồi HMAC-SHA512. */
const expectedVnpayHash = (params: Record<string, string>) =>
  createHmac('sha512', settings().VNPAY.secret)
    .update(signatureString(vnpaySignableParams(params)))
    .digest('hex');

test('AC4: VNPay init ký đúng HMAC-SHA512, tiền ×100 đúng một lần, giờ theo GMT+7', () => {
  const url = new URL(new VnpayAdapter(settings().VNPAY).init(baseRequest).paymentUrl);
  expect(url.origin).toBe('https://sandbox.vnpayment.vn');
  expect(url.searchParams.get('vnp_Amount')).toBe('90700000');
  expect(url.searchParams.get('vnp_CreateDate')).toBe('20261009071402');
  const params: Record<string, string> = Object.fromEntries(url.searchParams);
  expect(params['vnp_SecureHash']).toBe(expectedVnpayHash(params));
  expect(params['vnp_TxnRef']).toBe(orderRef);
  expect(params['cardNumber']).toBeUndefined();
});

test('AC4: MoMo init ký đúng HMAC-SHA256 theo danh sách trường, tiền giữ VND nguyên', () => {
  const session = new MomoAdapter(settings().MOMO).init(baseRequest);
  expect(session.providerRef).toBe(orderRef);
  const url = new URL(session.paymentUrl);
  const values: Record<string, string> = {
    accessKey: settings().MOMO.accessKey,
    amount: '907000',
    extraData: '',
    ipnUrl: baseRequest.ipnUrl,
    orderId: orderRef,
    orderInfo: url.searchParams.get('orderInfo') ?? '',
    partnerCode: 'PINEMOCK',
    redirectUrl: baseRequest.returnUrl,
    requestId: orderRef,
    requestType: 'captureWallet',
  };
  const sorted = Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key]}`)
    .join('&');
  expect(createHmac('sha256', settings().MOMO.secret).update(sorted).digest('hex')).toBe(
    url.searchParams.get('signature'),
  );
  expect(url.searchParams.get('amount')).toBe('907000');
});

test('AC4: bộ mô phỏng cùng hợp đồng — verify chuẩn hoá kết quả, sửa tiền sau khi ký bị từ chối', () => {
  const simulator = new PspSimulator(settings());
  const token = simulator.event({
    method: 'VNPAY',
    orderRef,
    amount: 907000n,
    outcome: 'SUCCEEDED',
    providerTxnId: 'VNP-123456',
    at: now,
  });
  expect(new VnpayAdapter(settings().VNPAY).verify(token)).toEqual({
    orderRef,
    providerTxnId: 'VNP-123456',
    amount: 907000n,
    outcome: 'SUCCEEDED',
    // `at` đọc về cùng thời điểm tuyệt đối (parser GMT+7).
    paidAt: now,
  });
  const tampered = token.replace('vnp_Amount=90700000', 'vnp_Amount=99700000');
  expect(new VnpayAdapter(settings().VNPAY).verify(tampered)).toBeNull();
});

test('AC4: sự kiện MoMo FAILED được chuẩn hoá đúng; sai chữ ký/thân lạ bị từ chối, không đoán', () => {
  const event = {
    method: 'MOMO' as const,
    orderRef,
    amount: 907000n,
    outcome: 'FAILED' as const,
    providerTxnId: 'MOMO-9',
    at: now,
  };
  const token = new PspSimulator(settings()).event(event);
  expect(new MomoAdapter(settings().MOMO).verify(token)).toEqual(
    expect.objectContaining({ orderRef, outcome: 'FAILED', amount: 907000n }),
  );
  const forged = JSON.stringify({ ...JSON.parse(token), signature: 'deadbeef' });
  expect(new MomoAdapter(settings().MOMO).verify(forged)).toBeNull();
  expect(new MomoAdapter(settings().MOMO).verify('not-json')).toBeNull();
  expect(new VnpayAdapter(settings().VNPAY).verify('vnp_TxnRef=x')).toBeNull();
});

test('AC4: URL cổng cấu hình lỗi ⇒ lỗi biên adapter (use case đổi thành 502 E_PAY_GATEWAY_ERROR)', () => {
  const broken = { ...settings(), VNPAY: { ...settings().VNPAY, paymentUrl: 'not-a-url' } };
  expect(() => new VnpayAdapter(broken.VNPAY).init(baseRequest)).toThrow();
});

test('AC4: điền đủ khoá ⇒ chế độ `live` chỉ nhờ cấu hình, adapter không đổi; ca mô phỏng vẫn xác minh được', () => {
  const live = pspSettings(LIVE_CONFIG);
  expect(live.VNPAY.mode).toBe('live');
  expect(live.MOMO.mode).toBe('live');
  expect(live.MOMO.merchantCode).toBe('MOMOTEST');
  const token = new PspSimulator(live).event({
    method: 'MOMO',
    orderRef,
    amount: 907000n,
    outcome: 'SUCCEEDED',
    providerTxnId: 'MOMO-8',
    at: now,
  });
  expect(new MomoAdapter(live.MOMO).verify(token)).toEqual(
    expect.objectContaining({ orderRef, amount: 907000n, outcome: 'SUCCEEDED' }),
  );
});

/** Encode độc lập theo quy tắc VNPay (giống `URLSearchParams`: khoảng trắng thành `+`). */
const vnpayEncoded = (value: string) => encodeURIComponent(value).replaceAll('%20', '+');

test('P1/F2: chuỗi ký VNPay URL-encode giá trị — fixture từ tài liệu, gồm `vnp_ReturnUrl`/`vnp_OrderInfo`', () => {
  const returnUrl = 'https://guest.app/booking/return?step=done&ref=1';
  const session = new VnpayAdapter(settings().VNPAY).init({ ...baseRequest, returnUrl });
  const url = new URL(session.paymentUrl);
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams)
    if (key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType') params[key] = value;
  const encoded = Object.keys(params)
    .sort()
    .map((key) => `${key}=${vnpayEncoded(params[key] ?? '')}`)
    .join('&');
  const decoded = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key] ?? ''}`)
    .join('&');
  const expected = createHmac('sha512', settings().VNPAY.secret).update(encoded).digest('hex');
  // Giá trị có ký tự phải encode vẫn nằm trong dữ liệu ký ở dạng đã encode, không phải dạng thô.
  expect(encoded).toContain(
    'vnp_ReturnUrl=https%3A%2F%2Fguest.app%2Fbooking%2Freturn%3Fstep%3Ddone%26ref%3D1',
  );
  expect(encoded).toContain('vnp_OrderInfo=Thanh+toan+DEPOSIT');
  expect(url.searchParams.get('vnp_SecureHash')).toBe(expected);
  expect(url.searchParams.get('vnp_SecureHash')).not.toBe(
    createHmac('sha512', settings().VNPAY.secret).update(decoded).digest('hex'),
  );
  // `verify` đối chiếu được với chính URL đã phát ra: dựng sự kiện từ tham số đó rồi xác minh.
  const event = new URLSearchParams(url.searchParams);
  event.set('vnp_ResponseCode', '00');
  event.set('vnp_TransactionStatus', '00');
  event.set('vnp_TransactionNo', 'VNP-9');
  event.delete('vnp_SecureHash');
  event.delete('vnp_SecureHashType');
  const resigned = createHmac('sha512', settings().VNPAY.secret)
    .update(
      [...event.keys()]
        .sort()
        .map((key) => `${key}=${vnpayEncoded(event.get(key) ?? '')}`)
        .join('&'),
    )
    .digest('hex');
  event.set('vnp_SecureHash', resigned);
  expect(new VnpayAdapter(settings().VNPAY).verify(event.toString())).toEqual(
    expect.objectContaining({ orderRef, amount: 907000n, outcome: 'SUCCEEDED' }),
  );
});

test('P0/F1: thiếu `PSP_ALLOW_MOCK` ⇒ `verify` của adapter mô phỏng từ chối mọi sự kiện', () => {
  const sealed = pspSettings({ ...MOCK_CONFIG, PSP_ALLOW_MOCK: undefined });
  const token = new PspSimulator({ ...settings(), VNPAY: sealed.VNPAY, MOMO: sealed.MOMO }).event({
    method: 'MOMO',
    orderRef,
    amount: 907000n,
    outcome: 'SUCCEEDED',
    providerTxnId: 'MOMO-1',
    at: now,
  });
  expect(new MomoAdapter(sealed.MOMO).verify(token)).toBeNull();
  const vnpayToken = new PspSimulator(sealed).event({
    method: 'VNPAY',
    orderRef,
    amount: 907000n,
    outcome: 'SUCCEEDED',
    providerTxnId: 'VNP-1',
    at: now,
  });
  expect(new VnpayAdapter(sealed.VNPAY).verify(vnpayToken)).toBeNull();
});

test('P0/F1: production mà còn cổng ở chế độ mô phỏng (hoặc thiếu gốc callback) ⇒ dừng khởi động', () => {
  expect(() => pspSettings({ ...MOCK_CONFIG, NODE_ENV: 'production' })).toThrow(/production/i);
  expect(() =>
    pspSettings({
      ...MOCK_CONFIG,
      NODE_ENV: 'production',
      VNPAY_TMN_CODE: 'LIVEVN',
      VNPAY_HASH_SECRET: 'live-secret',
    }),
  ).toThrow(/production/i); // MoMo còn thiếu bộ khoá ⇒ vẫn là mock
  expect(() =>
    pspSettings({
      ...MOCK_CONFIG,
      NODE_ENV: 'production',
      VNPAY_TMN_CODE: 'LIVEVN',
      VNPAY_HASH_SECRET: 'live-secret',
      MOMO_PARTNER_CODE: 'LIVEMOMO',
      MOMO_ACCESS_KEY: 'live-access',
      MOMO_SECRET_KEY: 'live-secret',
    }),
  ).toThrow(/PAYMENT_PSP_CALLBACK_BASE_URL|production/i);
  expect(
    pspSettings({
      ...MOCK_CONFIG,
      NODE_ENV: 'production',
      VNPAY_TMN_CODE: 'LIVEVN',
      VNPAY_HASH_SECRET: 'live-secret',
      MOMO_PARTNER_CODE: 'LIVEMOMO',
      MOMO_ACCESS_KEY: 'live-access',
      MOMO_SECRET_KEY: 'live-secret',
      PAYMENT_PSP_CALLBACK_BASE_URL: 'https://api.pinehill.vn',
    }),
  ).toMatchObject({ callbackBaseUrl: 'https://api.pinehill.vn' });
});

test('P2/F4: danh sách trắng `returnUrl` lấy origin khai tường minh, hoặc origin gốc callback', () => {
  expect(
    pspSettings({
      ...MOCK_CONFIG,
      PAYMENT_RETURN_URL_ORIGINS: 'https://guest.app, https://ops.app/',
    }).returnUrlOrigins,
  ).toEqual(['https://guest.app', 'https://ops.app']);
  expect(
    pspSettings({ ...MOCK_CONFIG, PAYMENT_PSP_CALLBACK_BASE_URL: 'https://api.pinehill.vn' })
      .returnUrlOrigins,
  ).toEqual(['https://api.pinehill.vn']);
  // Chưa khai gì ⇒ dev/test cho qua (production đã bị chặn ở test trên).
  expect(pspSettings(MOCK_CONFIG).returnUrlOrigins).toEqual([]);
  expect(allowedReturnUrl(pspSettings(MOCK_CONFIG), 'https://any.app/x')).toBe(true);
  expect(
    allowedReturnUrl(
      pspSettings({ ...MOCK_CONFIG, PAYMENT_RETURN_URL_ORIGINS: 'https://guest.app' }),
      'https://evil.app/x',
    ),
  ).toBe(false);
});
