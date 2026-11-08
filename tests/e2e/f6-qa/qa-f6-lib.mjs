/**
 * HB-194 — hạ tầng dùng chung của lượt QA F6 (CHAN/OVER) trên **API + worker thật**.
 *
 * Dựng trên `tests/e2e/f5/qa-f5-lib.mjs` (CSDL tạm `hb117_qa_*`, migrate + seed dev, API/worker thật với
 * đồng hồ nghiệp vụ điều khiển được, PIN cho các tài khoản dev). File này chỉ thêm dữ kiện F6:
 * account OTA tổng hợp trong `system_settings['chan.ota.accounts']`, ánh xạ kênh qua **API thật**
 * (`PUT /channels/{id}/mappings`, OWNER), bộ gửi webhook ký HMAC đúng hợp đồng simulator (api.md §5.1),
 * và các phép chờ trạng thái bằng SQL độc lập. Không import mã trong `apps/**`/`packages/**`.
 *
 * Bí mật HMAC dựng từ nhãn bằng SHA-256 (không phải khoá thật, không literal cạnh `secret:`).
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_BASE,
  api,
  bootstrap as bootstrapF5,
  check,
  dbInfo,
  findings,
  login,
  repoRoot,
  results,
  PASSWORD as PASSWORD_F5,
  PIN as PIN_F5,
  setClock as setClockF5,
  sql,
  vn,
  wait,
} from '../f5/qa-f5-lib.mjs';

export { API_BASE, api, check, dbInfo, findings, login, repoRoot, results, sql, vn, wait };
export { finding, mintPin, PIN, PASSWORD, teardown } from '../f5/qa-f5-lib.mjs';

/** Độ lệch đồng hồ nghiệp vụ của API/worker so với giờ thật (clock-shim của F5). */
let clockOffset = 0;
export async function setClock(date, time) {
  clockOffset = vn(date, time) - Date.now();
  await setClockF5(date, time);
}
/** Giờ hiện hành **của máy chủ** — dùng cho `t` của chữ ký và mốc sự kiện. */
export const serverNow = () => Date.now() + clockOffset;

/** Trạng thái phụ của báo cáo: chạy được nhưng thiếu điều kiện (BLOCKED) hoặc chưa chạy (NOT_RUN). */
export const extra = [];
export function blocked(name, reason) {
  extra.push({ name, status: 'BLOCKED', detail: reason });
  console.log(`BLOCKED  ${name} — ${reason}`);
}
export function notRun(name, reason) {
  extra.push({ name, status: 'NOT_RUN', detail: reason });
  console.log(`NOT_RUN  ${name} — ${reason}`);
}

const secretFor = (label) => createHash('sha256').update(`hb194-qa-hmac:${label}`).digest('hex');
export const OTA_ACCOUNTS = {
  booking: [{ keyId: 'hb194-booking', accountId: 'hb194-booking-acc', secret: secretFor('booking') }],
  agoda: [{ keyId: 'hb194-agoda', accountId: 'hb194-agoda-acc', secret: secretFor('agoda') }],
  airbnb: [{ keyId: 'hb194-airbnb', accountId: 'hb194-airbnb-acc', secret: secretFor('airbnb') }],
};
export const CHANNEL_OF = { booking: 'OTA_BOOKING', agoda: 'OTA_AGODA', airbnb: 'OTA_AIRBNB' };
export const PROPERTY = 'CS-01';

export const ids = { property: {}, roomType: {}, channel: {} };

/** CSDL + API + worker thật, rồi cấu hình F6 qua đúng đường production cho phép. */
export async function bootstrap({ settings = {} } = {}) {
  process.env.OTA_INBOX_INTERVAL_SECONDS ??= '1';
  process.env.QA_WORKER_CLOCK ??= '1';
  await bootstrapF5({
    beforeWorker: async () => {
      for (const [key, value] of Object.entries(settings))
        await sql(
          `INSERT INTO system_settings(key, value, value_type, description) VALUES ($1, $2, 'STRING', 'HB-194 QA')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value],
        );
    },
  });
  for (const row of await sql('SELECT id, code FROM properties')) ids.property[row.code] = row.id;
  for (const row of await sql(
    `SELECT rt.id, rt.code, p.code AS property FROM room_types rt JOIN properties p ON p.id = rt.property_id`,
  ))
    (ids.roomType[row.property] ??= {})[row.code] = row.id;
  for (const row of await sql('SELECT id, code FROM channels')) ids.channel[row.code] = row.id;

  // Cấu hình adapter OTA là SystemSetting kiểu JSON (HB-128); không có tuyến API công bố để ghi khoá này.
  await sql(
    `INSERT INTO system_settings(key, value, value_type, description)
     VALUES ('chan.ota.accounts', $1, 'JSON', 'HB-194 QA synthetic OTA accounts')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, value_type = 'JSON'`,
    [JSON.stringify(OTA_ACCOUNTS)],
  );
  const owner = await login('owner');
  for (const code of Object.values(CHANNEL_OF)) {
    for (const type of ['STD', 'SUP', 'DLX', 'FAM', 'DOR']) {
      const res = await api(`/channels/${ids.channel[code]}/mappings`, {
        token: owner,
        method: 'PUT',
        headers: { 'If-Match': await channelVersion(owner, code) },
        body: { roomTypeId: ids.roomType[PROPERTY][type], providerRoomTypeCode: type, allotmentPct: 80 },
      });
      if (![200, 201, 204].includes(res.status))
        throw new Error(`mapping ${code}/${type} → ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
}

/** `If-Match` của kênh: version hiện hành trong `GET /channels` (api.md §1.3; đổi sau mỗi lệnh ghi). */
export async function channelVersion(token, code) {
  const res = await api('/channels', { token });
  const row = res.body?.data?.find((c) => c.code === code);
  if (res.status !== 200 || row === undefined) throw new Error(`GET /channels → ${res.status}`);
  return `"${row.version}"`;
}

/** Giá kênh OTA do **engine giá của máy chủ** trả qua báo giá đa kênh (HB-056) — không tự tính. */
export async function otaPrice({ channelCode, roomType = 'STD', checkIn, checkOut, property = PROPERTY }) {
  const token = await login('manager');
  const res = await api('/quotes/multi-channel', {
    token,
    method: 'POST',
    key: null,
    body: { roomTypeId: ids.roomType[property][roomType], checkIn, checkOut, channelCodes: [channelCode] },
  });
  const option = res.body?.options?.find((o) => o.channelCode === channelCode);
  if (res.status !== 200 || !option) throw new Error(`multi-channel → ${res.status} ${JSON.stringify(res.body)}`);
  return option.totalFrom;
}

let seq = 0;
/** Gửi một sự kiện OTA đã ký (HMAC-SHA256 trên `t + "." + rawBody`, api.md §5.1). */
export async function otaSend(input) {
  const provider = input.provider ?? 'booking';
  const account = OTA_ACCOUNTS[provider][0];
  seq += 1;
  const body = {
    eventType: input.eventType ?? 'booking.created',
    providerAccountId: account.accountId,
    providerBookingCode: input.code,
    providerUpdatedAt: input.updatedAt ?? new Date(serverNow() + seq).toISOString(),
    propertyCode: input.property ?? PROPERTY,
    roomTypeCode: input.roomType ?? 'STD',
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: input.adults ?? 2,
    children: input.children ?? 0,
    roomCount: input.roomCount ?? 1,
    guest: { fullName: input.guestName ?? `QA F6 ${input.code}`, phone: input.phone ?? '+84900000194' },
    amount: input.amount,
    currency: 'VND',
    paymentCollected: input.paymentCollected ?? true,
  };
  const raw = JSON.stringify(body);
  const t = input.timestamp ?? Math.floor(serverNow() / 1000);
  const secret = input.forgeSecret ? `${account.secret}:forged` : account.secret;
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const eventId = input.eventId ?? `hb194-${input.code}-${body.eventType}-${seq}`;
  const response = await fetch(`${API_BASE}/integrations/ota/${provider}/bookings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pinehill-signature': `t=${t},v1=${v1}`,
      'x-pinehill-key-id': account.keyId,
      'x-channel-event-id': eventId,
    },
    body: raw,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, body: json, eventId, raw, provider, account };
}

/** Chờ worker xử lý xong hàng inbox (PROCESSED/QUARANTINED/FAILED) — đọc thẳng CSDL. */
export async function waitInbox(eventId, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await sql('SELECT status, last_error, attempts FROM webhook_inbox WHERE event_id = $1', [eventId]);
    if (row && row.status !== 'PENDING' && row.status !== 'PROCESSING') return row;
    if (Date.now() > until) return row ?? { status: 'MISSING' };
    await wait(250);
  }
}

/** Chờ một điều kiện SQL/HTTP thành đúng; trả giá trị cuối và thời gian đã chờ. */
export async function waitFor(probe, { timeoutMs = 60_000, everyMs = 500 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return { value, ms: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { value, ms: Date.now() - started };
    await wait(everyMs);
  }
}

export const bookingOf = async (externalRef) =>
  (await sql('SELECT * FROM bookings WHERE external_ref LIKE $1', [`%/${externalRef}`]))[0];

export const key = () => randomUUID();

/** Ghi kết quả máy đọc được cho tài liệu bằng chứng (không chứa token/PIN/secret). */
export function writeReport(name, meta) {
  const dir = join(repoRoot, 'tests/e2e/f6-qa/results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  // AC8: artefact không được chứa token/PIN/mật khẩu/bí mật HMAC — kiểm trên chính nội dung sắp ghi.
  const draft = JSON.stringify({ ...meta, results, extra, findings });
  const secrets = Object.values(OTA_ACCOUNTS).flat().map((a) => a.secret);
  const leaks = [
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(draft) ? 'jwt' : null,
    draft.includes(PASSWORD_F5) ? 'password' : null,
    new RegExp(`"(pin|pinToken)":"?${PIN_F5}`).test(draft) ? 'pin' : null,
    secrets.some((x) => draft.includes(x)) ? 'hmac-secret' : null,
  ].filter(Boolean);
  check('redacted_reproducible_artifacts', leaks.length === 0, leaks.length === 0 ? `${name}.json không có token/PIN/mật khẩu/secret` : leaks.join(','));
  writeFileSync(file, JSON.stringify({ ...meta, results, extra, findings }, null, 2));
  const fail = results.filter((r) => !r.pass).length;
  console.log(
    `\n${results.length - fail} PASS · ${fail} FAIL · ${extra.filter((e) => e.status === 'BLOCKED').length} BLOCKED · ${extra.filter((e) => e.status === 'NOT_RUN').length} NOT_RUN · ${findings.length} FINDING → ${file}`,
  );
}
