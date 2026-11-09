/**
 * HB-184 — thư viện chung của các kịch bản k6 (kế hoạch kiểm thử §7). Chỉ dùng dữ liệu giả do
 * `chay-cuc-bo.mjs` (hoặc bước chuẩn bị staging) ghi vào `LOAD_FIXTURE`: id cơ sở/loại phòng/gói giá,
 * access token nhân viên + khách đã đăng nhập sẵn, khoảng ngày và (tuỳ chọn) tài khoản OTA tổng hợp.
 *
 * Token không in ra log; k6 chỉ xuất số đo theo tag `op`.
 */
import http from 'k6/http';
import crypto from 'k6/crypto';
import { Counter, Rate } from 'k6/metrics';

export const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000/api/v1';
export const fixture = JSON.parse(open(__ENV.LOAD_FIXTURE || './fixture.json'));

/** 5xx là lỗi hệ thống; 409/422 là phán quyết nghiệp vụ; 429 là giới hạn tần suất công khai (đếm riêng). */
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409, 422, 429));
export const serverErrors = new Rate('server_errors');
export const rateLimited = new Counter('rate_limited');

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const seen = new Set();
function track(response) {
  serverErrors.add(response.status >= 500);
  // Mỗi cặp (op, mã) bất thường in một lần, chỉ mã lỗi công bố — không in body/token.
  const op = response.request?.tags?.op ?? '';
  if (response.status >= 400 && ![409, 422, 429].includes(response.status) && !seen.has(`${op}:${response.status}`)) {
    seen.add(`${op}:${response.status}`);
    let code = '';
    try {
      code = response.json('code') ?? '';
    } catch {
      code = '';
    }
    console.warn(`unexpected ${response.status} ${code} at ${response.request?.method} ${response.url.split('?')[0]}`);
  }
  if (response.status === 429) rateLimited.add(1);
  return response;
}

export function get(path, { token, op, query } = {}) {
  const qs = query
    ? `?${Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')}`
    : '';
  return track(
    http.get(`${BASE}${path}${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      tags: { op },
    }),
  );
}

export function post(path, body, { token, op, headers = {} } = {}) {
  return track(
    http.post(`${BASE}${path}`, JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': uuid(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      tags: { op },
    }),
  );
}

export const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Kỳ lưu trú ngẫu nhiên 1–3 đêm trong cửa sổ dữ liệu tải. */
export function randomStay() {
  const start = Date.parse(`${fixture.window.from}T00:00:00Z`);
  const span = Math.max(1, fixture.window.days - 4);
  const day = start + Math.floor(Math.random() * span) * 86_400_000;
  const nights = 1 + Math.floor(Math.random() * 3);
  return {
    checkIn: new Date(day).toISOString().slice(0, 10),
    checkOut: new Date(day + nights * 86_400_000).toISOString().slice(0, 10),
  };
}

export function stayQuery(roomTypeId, stay, channelCode = 'WEB') {
  return {
    propertyId: fixture.propertyId,
    roomTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: 2,
    children: 0,
    roomCount: 1,
    channelCode,
  };
}

export function quote(token, roomTypeId, stay) {
  return post(
    '/quotes',
    { ...stayQuery(roomTypeId, stay), ratePlanCode: fixture.ratePlanCode },
    { token, op: 'quote' },
  );
}

/** Webhook OTA ký HMAC-SHA256 trên `t + "." + rawBody` (api.md §5.1). */
export function otaWebhook(index, stay) {
  const ota = fixture.ota;
  const raw = JSON.stringify({
    eventType: 'booking.created',
    providerAccountId: ota.accountId,
    providerBookingCode: `LOAD-${fixture.runId}-${index}`,
    providerUpdatedAt: new Date().toISOString(),
    propertyCode: fixture.propertyCode,
    roomTypeCode: ota.roomTypeCode,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: 2,
    children: 0,
    roomCount: 1,
    guest: { fullName: `Load Guest ${index}`, phone: `+8490${String(1_000_000 + index).slice(-7)}` },
    amount: ota.amount,
    currency: 'VND',
    paymentCollected: true,
  });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.hmac('sha256', ota.secret, `${t}.${raw}`, 'hex');
  return track(
    http.post(`${BASE}/integrations/ota/${ota.provider}/bookings`, raw, {
      headers: {
        'content-type': 'application/json',
        'x-pinehill-signature': `t=${t},v1=${v1}`,
        'x-pinehill-key-id': ota.keyId,
        'x-channel-event-id': `load-${fixture.runId}-${index}`,
      },
      tags: { op: 'ota' },
    }),
  );
}
