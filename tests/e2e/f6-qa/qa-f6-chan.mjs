#!/usr/bin/env node
/**
 * HB-194 — QA F6 phần CHAN (TC-CHAN-01…11) trên API + worker **thật**.
 *
 * Chạy: `REDIS_URL=redis://127.0.0.1:6379/10 node tests/e2e/f6-qa/qa-f6-chan.mjs` (cần `DATABASE_MIGRATION_URL`,
 * `DATABASE_URL` như `tests/e2e/f5`). Sự kiện OTA đi qua `POST /integrations/ota/{channel}/bookings` có ký
 * HMAC; worker `q.ota-inbox` áp booking; bên nhận đồng bộ là máy chủ HTTP cục bộ của script (đặt vào
 * `chan.ota.simulator.baseUrl`). Mọi kỳ vọng đọc lại bằng HTTP của API và SQL độc lập; số tiền OTA lấy từ
 * engine giá của máy chủ (`POST /quotes/multi-channel`), không tính trong script.
 */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import {
  API_BASE,
  api,
  blocked,
  bookingOf,
  bootstrap,
  channelVersion,
  check,
  finding,
  ids,
  login,
  notRun,
  otaPrice,
  otaSend,
  OTA_ACCOUNTS,
  PROPERTY,
  repoRoot,
  serverNow,
  setClock,
  sql,
  teardown,
  wait,
  waitFor,
  waitInbox,
  writeReport,
} from './qa-f6-lib.mjs';

const started = new Date();
const SYNC_INTERVAL_SECONDS = 20;
const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '');
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();

/** Bên nhận đồng bộ: ghi mọi bản tin; `failMode = true` trả 500 để ép lỗi (TC-CHAN-05). */
const received = [];
let failMode = false;
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      received.push({ at: Date.now(), body: JSON.parse(body) });
    } catch {
      received.push({ at: Date.now(), body: null });
    }
    const failing = failMode && received.at(-1)?.body?.channelCode === 'OTA_AGODA';
    res.writeHead(failing ? 500 : 200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});
await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiverUrl = `http://127.0.0.1:${receiver.address().port}/ota-sync`;

async function availability(channelCode, roomType, checkIn, checkOut) {
  const token = await login('manager');
  const query = new URLSearchParams({
    propertyId: ids.property[PROPERTY],
    roomTypeId: ids.roomType[PROPERTY][roomType],
    checkIn,
    checkOut,
    adults: '2',
    children: '0',
    roomCount: '1',
    channelCode,
  });
  const res = await api(`/inventory/availability?${query}`, { token });
  const row = res.body?.data?.find((r) => r.roomTypeId === ids.roomType[PROPERTY][roomType]);
  return { status: res.status, count: row?.availableCount ?? 0, body: res.body };
}

/** Một booking OTA đã thu tiền với đúng giá kênh của máy chủ; trả hàng inbox sau khi worker áp. */
async function otaBooking({ provider = 'booking', code, roomType = 'STD', checkIn, checkOut, eventType }) {
  const channelCode = { booking: 'OTA_BOOKING', agoda: 'OTA_AGODA', airbnb: 'OTA_AIRBNB' }[provider];
  const amount = await otaPrice({ channelCode, roomType, checkIn, checkOut });
  const sent = await otaSend({ provider, code, roomType, checkIn, checkOut, amount, eventType });
  const inbox = await waitInbox(sent.eventId);
  return { sent, inbox, amount };
}

async function syncChannel(code, body = { scope: 'FULL' }) {
  const token = await login('manager');
  return api(`/channels/${ids.channel[code]}/sync`, {
    token,
    method: 'POST',
    headers: { 'If-Match': await channelVersion(token, code) },
    body,
  });
}

async function tc08() {
  const name = 'TC_CHAN_08_invalid_signature_evidence';
  const amount = await otaPrice({ channelCode: 'OTA_BOOKING', checkIn: '2026-12-10', checkOut: '2026-12-12' });
  const forged = await otaSend({ code: 'C08-FORGED', checkIn: '2026-12-10', checkOut: '2026-12-12', amount, forgeSecret: true });
  const inbox = await sql('SELECT count(*)::int AS n FROM webhook_inbox WHERE event_id = $1', [forged.eventId]);
  const booking = await bookingOf('C08-FORGED');
  check(
    name,
    forged.status === 401 && forged.body?.code === 'E_CHAN_SIGNATURE_INVALID' && inbox[0].n === 0 && booking === undefined,
    `status=${forged.status} code=${forged.body?.code} inbox=${inbox[0].n} booking=${booking?.id ?? 'none'}`,
  );
  // Chữ ký đúng nhưng mốc `t` cũ 30 phút (ngoài ±300 giây) cũng bị 401 (TC-CHAN-09 ca phụ).
  const stale = await otaSend({
    code: 'C08-STALE',
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    amount,
    timestamp: Math.floor(serverNow() / 1000) - 1800,
  });
  check(`${name}::stale_timestamp_30m`, stale.status === 401, `status=${stale.status}`);
  const leaked = JSON.stringify(forged.body).includes(forged.account.secret) || JSON.stringify(forged.body).includes('v1=');
  check(`${name}::error_body_has_no_signature_or_secret`, !leaked, JSON.stringify(forged.body));
}

async function tc09() {
  const name = 'TC_CHAN_09_webhook_replay_one_booking';
  const first = await otaBooking({ code: 'C09-REPLAY', checkIn: '2026-12-10', checkOut: '2026-12-12' });
  const booking = await bookingOf('C09-REPLAY');
  const before = await sql(
    `SELECT b.paid_amount::text AS paid, (SELECT count(*)::int FROM room_assignments ra JOIN booking_rooms br ON br.id = ra.booking_room_id WHERE br.booking_id = b.id) AS assignments
       FROM bookings b WHERE b.id = $1`,
    [booking?.id],
  );
  // Phát lại đúng raw body + event ID 5 lần, chữ ký có `t` mới trong ±300 giây.
  const statuses = [];
  for (let i = 0; i < 5; i += 1) {
    const replay = await otaSend({
      code: 'C09-REPLAY',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      amount: first.amount,
      eventId: first.sent.eventId,
      updatedAt: JSON.parse(first.sent.raw).providerUpdatedAt,
    });
    statuses.push(replay.status);
  }
  await wait(2500);
  const after = await sql(
    `SELECT b.paid_amount::text AS paid, (SELECT count(*)::int FROM room_assignments ra JOIN booking_rooms br ON br.id = ra.booking_room_id WHERE br.booking_id = b.id) AS assignments
       FROM bookings b WHERE b.id = $1`,
    [booking?.id],
  );
  const count = await sql("SELECT count(*)::int AS n FROM bookings WHERE external_ref LIKE '%/C09-REPLAY'");
  const inbox = await sql('SELECT count(*)::int AS n FROM webhook_inbox WHERE event_id = $1', [first.sent.eventId]);
  check(
    name,
    first.inbox.status === 'PROCESSED' &&
      count[0].n === 1 &&
      inbox[0].n === 1 &&
      statuses.every((s) => s === 200) &&
      JSON.stringify(before) === JSON.stringify(after),
    `inbox=${first.inbox.status} bookings=${count[0].n} inboxRows=${inbox[0].n} replays=${statuses} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
}

async function tc07() {
  const name = 'TC_CHAN_07_ota_cancel_no_refund';
  // Mốc dưới 24h trước nhận phòng: đồng hồ 01/12 09:00, nhận phòng 02/12.
  const created = await otaBooking({ provider: 'agoda', code: 'C07-CANCEL', checkIn: '2026-12-02', checkOut: '2026-12-03' });
  const cancel = await otaBooking({
    provider: 'agoda',
    code: 'C07-CANCEL',
    checkIn: '2026-12-02',
    checkOut: '2026-12-03',
    eventType: 'booking.cancelled',
  });
  const booking = await bookingOf('C07-CANCEL');
  const refunds = await sql('SELECT count(*)::int AS n FROM refund_requests WHERE booking_id = $1', [booking?.id]);
  check(
    name,
    created.inbox.status === 'PROCESSED' &&
      cancel.inbox.status === 'PROCESSED' &&
      booking?.status === 'CANCELLED' &&
      booking?.cancel_reason === 'OTA_CANCELLATION' &&
      typeof booking?.channel_policy_code === 'string' &&
      refunds[0].n === 0 &&
      Number(booking?.penalty_amount ?? 0) === 0,
    `inbox=${created.inbox.status}/${cancel.inbox.status}:${cancel.inbox.last_error} status=${booking?.status} reason=${booking?.cancel_reason} policy=${booking?.channel_policy_code} refunds=${refunds[0].n} penalty=${booking?.penalty_amount}`,
  );
}

/** FAM tại CS-01 có 3 phòng, quota mặc định floor(80% × 3) = 2: 5 cam kết OTA đã thu tiền (TC-CHAN-10, 03). */
async function tc10and03() {
  const name = 'TC_CHAN_10_active_quota_and_confirmed_exception';
  const owner = await login('owner');
  const prop = (await api('/properties', { token: owner })).body.data.find((p) => p.id === ids.property[PROPERTY]);
  const patched = await api(`/properties/${prop.id}`, {
    token: owner,
    method: 'PATCH',
    headers: { 'If-Match': `"${prop.version}"` },
    body: { overbookLimitPct: 0, reason: 'HB-194 TC-CHAN-03: overbookLimitPct = 0' },
  });
  if (patched.status !== 200) finding('QA-CHAN-SETUP', 'Không đặt được overbookLimitPct = 0 qua PATCH /properties', `${patched.status} ${JSON.stringify(patched.body)}`);
  const stay = { roomType: 'FAM', checkIn: '2026-12-15', checkOut: '2026-12-16' };
  const publishedBefore = await availability('OTA_BOOKING', stay.roomType, stay.checkIn, stay.checkOut);
  const outcomes = [];
  for (let i = 1; i <= 5; i += 1) {
    const r = await otaBooking({ code: `C10-${i}`, ...stay });
    const b = await bookingOf(`C10-${i}`);
    outcomes.push({ i, inbox: r.inbox.status, err: r.inbox.last_error, status: b?.status, oversold: b?.oversold });
  }
  const publishedAfter = await availability('OTA_BOOKING', stay.roomType, stay.checkIn, stay.checkOut);
  const cases = await sql('SELECT shortage_count, status FROM overbooking_cases WHERE room_type_id = $1 AND date = $2', [
    ids.roomType[PROPERTY].FAM,
    stay.checkIn,
  ]);
  const allConfirmed = outcomes.every((o) => o.inbox === 'PROCESSED' && o.status === 'CONFIRMED');
  const oversoldPattern = outcomes.map((o) => o.oversold).join(',');
  check(
    name,
    publishedBefore.count <= 2 && allConfirmed && oversoldPattern === 'false,false,false,true,true' && cases.length === 1 && cases[0].shortage_count === 2,
    `publishedBefore=${publishedBefore.count} publishedAfter=${publishedAfter.count} outcomes=${JSON.stringify(outcomes)} cases=${JSON.stringify(cases)}`,
  );
  // TC-CHAN-03: booking thứ 4 tới khi tồn vật lý = 0 và overbookLimitPct = 0.
  const fourth = outcomes[3];
  check(
    'TC_CHAN_03_confirmed_oversold',
    fourth?.status === 'CONFIRMED' && fourth?.oversold === true && cases.length === 1,
    `fourth=${JSON.stringify(fourth)} cases=${JSON.stringify(cases)}`,
  );
  const collect = await sql(
    `SELECT count(*)::int AS n FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE b.external_ref LIKE '%/C10-4' AND p.method = 'OTA_COLLECT' AND p.status = 'SUCCEEDED'`,
  );
  check('TC_CHAN_03_confirmed_oversold::ota_collect_payment', collect[0].n === 1, `payments=${collect[0].n}`);
}

/** DLX tại CS-01: thêm phòng qua API cho đủ 12 đơn vị ACTIVE; mỗi OTA thấy 9, WEB thấy 12 (TC-CHAN-01). */
async function tc01() {
  const name = 'TC_CHAN_01_per_channel_quota_projection';
  const owner = await login('owner');
  const existing = (await sql("SELECT count(*)::int AS n FROM rooms WHERE room_type_id = $1 AND status = 'ACTIVE'", [ids.roomType[PROPERTY].DLX]))[0].n;
  for (let i = existing + 1; i <= 12; i += 1) {
    const res = await api('/rooms', {
      token: owner,
      method: 'POST',
      body: { propertyId: ids.property[PROPERTY], roomTypeId: ids.roomType[PROPERTY].DLX, code: `CS01-9${String(i).padStart(2, '0')}`, floor: 9 },
    });
    if (res.status !== 201) throw new Error(`POST /rooms → ${res.status} ${JSON.stringify(res.body)}`);
  }
  const owners = {};
  for (const code of ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB', 'WEB', 'PHONE', 'WALKIN'])
    owners[code] = (await availability(code, 'DLX', '2026-12-22', '2026-12-23')).count;
  const otaOk = ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'].every((c) => owners[c] === 9);
  const directOk = ['WEB', 'PHONE', 'WALKIN'].every((c) => owners[c] === 12);
  check(name, otaOk && directOk, `availableCount=${JSON.stringify(owners)} (12 ACTIVE)`);

  // Hạn mức theo cấu hình: OWNER đặt OTA_AGODA/DLX = 50% ⇒ BR-CHAN-01 kỳ vọng floor(50% × 12) = 6 ở cả tồn khả dụng lẫn ảnh đẩy OTA.
  const put = await api(`/channels/${ids.channel.OTA_AGODA}/mappings`, {
    token: owner,
    method: 'PUT',
    headers: { 'If-Match': await channelVersion(owner, 'OTA_AGODA') },
    body: { roomTypeId: ids.roomType[PROPERTY].DLX, providerRoomTypeCode: 'DLX', allotmentPct: 50 },
  });
  const mark = received.length;
  const manager = await login('manager');
  const sync = await syncChannel('OTA_AGODA');
  await operationTerminal(manager, sync.headers.get('location') ?? '');
  const night = received
    .slice(mark)
    .filter((r) => r.body?.channelCode === 'OTA_AGODA')
    .map((r) => r.body.snapshot?.inventory?.find((n) => n.roomTypeId === ids.roomType[PROPERTY].DLX && n.date === '2026-12-22'))
    .find(Boolean);
  const agoda = (await availability('OTA_AGODA', 'DLX', '2026-12-22', '2026-12-23')).count;
  const applied = agoda === 6 && night?.quota === 6;
  check(`${name}::configured_allotment_pct_applied`, [200, 204].includes(put.status) && applied, `put=${put.status} availability=${agoda} snapshotNight=${JSON.stringify(night)}`);
  if (!applied)
    finding(
      'QA-F6-12',
      '`allotmentPct` OWNER đặt qua `PUT /channels/{id}/mappings` không đổi tồn công bố: engine `packages/domain/src/inventory/availability.ts::defaultOtaQuota` và ảnh tồn worker `channel-sync/snapshot.ts` đều cứng 80% khi không có dòng `channel_allotments`; chỉ quyết định đóng bán tự động (`chan/sync/projection.ts`) đọc `allotment_pct`.',
      `allotmentPct=50 ⇒ availability=${agoda} snapshotQuota=${night?.quota}`,
    );
}

/** SUP tại CS-01 có 6 phòng: 4 booking ⇒ còn 2 = ngưỡng ⇒ OTA đóng, trực tiếp vẫn bán; huỷ 1 ⇒ mở lại. */
async function tc04() {
  const name = 'TC_CHAN_04_server_closure_reopen';
  const stay = { roomType: 'SUP', checkIn: '2026-12-20', checkOut: '2026-12-21' };
  for (let i = 1; i <= 4; i += 1) await otaBooking({ provider: 'airbnb', code: `C04-${i}`, ...stay });
  const manager0 = await login('manager');
  const sync1 = await syncChannel('OTA_BOOKING');
  await operationTerminal(manager0, sync1.headers.get('location') ?? '');
  const closed = {};
  for (const code of ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB', 'WEB']) closed[code] = (await availability(code, stay.roomType, stay.checkIn, stay.checkOut)).count;
  await otaBooking({ provider: 'airbnb', code: 'C04-1', ...stay, eventType: 'booking.cancelled' });
  const sync2 = await syncChannel('OTA_BOOKING');
  await operationTerminal(manager0, sync2.headers.get('location') ?? '');
  const reopened = {};
  for (const code of ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB', 'WEB']) reopened[code] = (await availability(code, stay.roomType, stay.checkIn, stay.checkOut)).count;
  // Nhánh đóng thủ công: MANAGER đóng OTA_BOOKING; lượt sync sau (tồn > ngưỡng) không được tự mở lại.
  const manager = await login('manager');
  const manual = await api(`/channels/${ids.channel.OTA_BOOKING}/sales-closure`, {
    token: manager,
    method: 'POST',
    headers: { 'If-Match': await channelVersion(manager, 'OTA_BOOKING') },
    body: { roomTypeId: ids.roomType[PROPERTY].SUP, from: stay.checkIn, to: stay.checkOut, reason: 'HB-194 đóng thủ công' },
  });
  // `to` là mốc mở (`date < to`); khoảng rỗng from = to vẫn được nhận 200 mà không đóng gì.
  const empty = await api(`/channels/${ids.channel.OTA_AIRBNB}/sales-closure`, {
    token: manager,
    method: 'POST',
    headers: { 'If-Match': await channelVersion(manager, 'OTA_AIRBNB') },
    body: { roomTypeId: ids.roomType[PROPERTY].SUP, from: stay.checkIn, to: stay.checkIn, reason: 'HB-194 khoảng rỗng' },
  });
  if (empty.status === 200 && Array.isArray(empty.body?.rows) && empty.body.rows.length === 0)
    finding(
      'QA-F6-02',
      '`POST /channels/{id}/sales-closure` nhận `from = to` (khoảng rỗng vì `to` là mốc mở) và trả 200 với `rows: []` — lệnh ghi không làm gì nhưng báo thành công; nên 400 hoặc ghi rõ ngữ nghĩa nửa mở trong api.md §2.7.',
      `status=${empty.status} rows=${JSON.stringify(empty.body?.rows)}`,
    );
  const flagsOf = () =>
    sql(
      `SELECT c.code, a.is_closed, a.auto_closed, a.manual_closed FROM channel_allotments a JOIN channels c ON c.id = a.channel_id
        WHERE a.room_type_id = $1 AND a.date = $2 AND c.code = 'OTA_BOOKING'`,
      [ids.roomType[PROPERTY].SUP, stay.checkIn],
    );
  const beforeSync = await flagsOf();
  const availBeforeSync = (await availability('OTA_BOOKING', stay.roomType, stay.checkIn, stay.checkOut)).count;
  const resync = await syncChannel('OTA_BOOKING');
  await operationTerminal(manager, resync.headers.get('location') ?? '');
  const afterManual = (await availability('OTA_BOOKING', stay.roomType, stay.checkIn, stay.checkOut)).count;
  const flags = await sql(
    `SELECT c.code, a.is_closed, a.auto_closed, a.manual_closed FROM channel_allotments a JOIN channels c ON c.id = a.channel_id
      WHERE a.room_type_id = $1 AND a.date = $2 ORDER BY c.code`,
    [ids.roomType[PROPERTY].SUP, stay.checkIn],
  );
  check(
    `${name}::manual_closure_not_auto_reopened`,
    [200, 201].includes(manual.status) && afterManual === 0 && flags.some((f) => f.code === 'OTA_BOOKING' && f.is_closed && f.manual_closed && !f.auto_closed),
    `manual=${manual.status} view=${JSON.stringify(manual.body?.rows)} flagsBeforeSync=${JSON.stringify(beforeSync)} availBeforeSync=${availBeforeSync} availableAfterSync=${afterManual} flagsAfterSync=${JSON.stringify(flags)}`,
  );
  const otaClosed = ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'].every((c) => closed[c] === 0);
  const otaReopened = ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'].every((c) => reopened[c] > 0);
  check(
    name,
    sync1.status === 202 && sync2.status === 202 && otaClosed && closed.WEB === 2 && otaReopened && reopened.WEB === 3,
    `sync=${sync1.status}/${sync2.status} closed=${JSON.stringify(closed)} reopened=${JSON.stringify(reopened)}`,
  );
}

async function operationTerminal(token, location) {
  const path = location.replace(/^.*\/api\/v1/, '');
  const { value } = await waitFor(
    async () => {
      const res = await api(path, { token });
      return ['SUCCEEDED', 'FAILED'].includes(res.body?.status) ? res.body : null;
    },
    { timeoutMs: 120_000 },
  );
  return value;
}

/** Bên nhận trả 500 liên tục: 3 lượt sync liên tiếp ⇒ DEGRADED/3/lỗi an toàn + cảnh báo MANAGER; kênh khác giữ OK. */
async function tc05() {
  const name = 'TC_CHAN_05_degraded_retry_operation';
  const manager = await login('manager');
  failMode = true;
  const ops = [];
  for (let i = 0; i < 3; i += 1) {
    const res = await syncChannel('OTA_AGODA');
    const location = res.headers.get('location') ?? res.body?.statusUrl ?? '';
    ops.push({ status: res.status, terminal: location ? (await operationTerminal(manager, location))?.status : 'NO_LOCATION' });
  }
  const degraded = (await api(`/channels/${ids.channel.OTA_AGODA}/sync-status`, { token: manager })).body;
  const others = {};
  for (const code of ['OTA_BOOKING', 'OTA_AIRBNB'])
    others[code] = (await api(`/channels/${ids.channel[code]}/sync-status`, { token: manager })).body?.syncStatus;
  const alerts = await sql(
    `SELECT n.recipient, n.status, (SELECT count(*)::int FROM audit_logs a WHERE a.entity_id = n.id AND a.action = 'ALERT_RAISED') AS audits
       FROM notifications n WHERE n.template = 'alert-channel-degraded' AND n.payload_json->>'channelCode' = 'OTA_AGODA'`,
  );
  const leak = /v1=|secret|password|token/i.test(degraded?.lastError ?? '');
  check(
    name,
    ops.every((o) => o.status === 202) &&
      degraded?.syncStatus === 'DEGRADED' &&
      degraded?.consecutiveFailures === 3 &&
      typeof degraded?.lastError === 'string' &&
      !leak &&
      Object.values(others).every((v) => v !== 'DEGRADED'),
    `ops=${JSON.stringify(ops)} agoda=${JSON.stringify({ s: degraded?.syncStatus, n: degraded?.consecutiveFailures, err: degraded?.lastError })} others=${JSON.stringify(others)}`,
  );
  check(`${name}::manager_alert_persisted`, alerts.length === 1 && alerts[0].audits === 1, `notifications=${JSON.stringify(alerts)}`);
  // Phục hồi: bên nhận 200 ⇒ lượt sync kế tiếp về OK/0.
  failMode = false;
  const retry = await syncChannel('OTA_AGODA');
  const location = retry.headers.get('location') ?? retry.body?.statusUrl ?? '';
  const terminal = location ? await operationTerminal(manager, location) : null;
  const healed = (await api(`/channels/${ids.channel.OTA_AGODA}/sync-status`, { token: manager })).body;
  check(
    `${name}::retry_operation_heals`,
    retry.status === 202 && terminal?.status === 'SUCCEEDED' && healed?.syncStatus === 'OK' && healed?.consecutiveFailures === 0,
    `retry=${retry.status} terminal=${terminal?.status} healed=${JSON.stringify({ s: healed?.syncStatus, n: healed?.consecutiveFailures })}`,
  );
}

/** Huỷ một booking OTA để tồn tăng; đo thời gian tới bản tin đồng bộ phản ánh tồn mới ở bên nhận (≤ 5 phút). */
async function tc02() {
  const name = 'TC_CHAN_02_outbox_delivery_5m';
  const stay = { roomType: 'STD', checkIn: '2026-12-26', checkOut: '2026-12-27' };
  await otaBooking({ code: 'C02-1', ...stay });
  const stdId = ids.roomType[PROPERTY].STD;
  const unitsOf = (snap) =>
    snap?.body?.channelCode === 'OTA_BOOKING'
      ? snap.body.snapshot?.inventory?.find((n) => n.roomTypeId === stdId && n.date === stay.checkIn)
      : undefined;
  const mark = received.length;
  const cancelledAt = Date.now();
  const cancel = await otaBooking({ code: 'C02-1', ...stay, eventType: 'booking.cancelled' });
  const outbox = await sql(
    `SELECT count(*)::int AS n FROM outbox_events WHERE created_at >= now() - interval '2 minutes'`,
  );
  const { value, ms } = await waitFor(
    () => received.slice(mark).find((snap) => unitsOf(snap) !== undefined) ?? null,
    { timeoutMs: 330_000, everyMs: 1000 },
  );
  check(
    name,
    cancel.inbox.status === 'PROCESSED' && value !== null && ms <= 300_000,
    `cancel=${cancel.inbox.status} outboxRecent=${outbox[0].n} firstSnapshotAfterCancelMs=${value ? value.at - cancelledAt : 'none'} night=${JSON.stringify(unitsOf(value))}`,
  );
  notRun(
    `${name}::relay_restart_no_loss_no_duplicate`,
    'Không khởi động lại worker giữa lượt (bootstrap F5 không lộ tiến trình worker); bằng chứng mất/nhân đôi khi relay chết thuộc test khoá HB-130 apps/api/test/outbox-relay/**',
  );
}

/** 20 booking đa kênh trong ≤ 5 phút, đúng một booking vượt tồn có `oversold` + case (SCR-42/43). */
async function tc11() {
  const name = 'TC_CHAN_11_twenty_bookings_five_minutes';
  const providers = ['booking', 'agoda', 'airbnb'];
  // DLX đã có 12 phòng (TC-CHAN-01). 13 booking cho đêm 28/12 ⇒ đúng 1 vượt tồn; 7 booking STD cho đêm khác.
  const plan = [];
  for (let i = 0; i < 13; i += 1) plan.push({ roomType: 'DLX', checkIn: '2026-12-28', checkOut: '2026-12-29' });
  for (let i = 0; i < 7; i += 1) plan.push({ roomType: 'STD', checkIn: '2026-12-29', checkOut: '2026-12-30' });
  const prices = {};
  for (const p of providers)
    for (const t of ['DLX', 'STD']) {
      const s = t === 'DLX' ? plan[0] : plan[13];
      prices[`${p}/${t}`] = await otaPrice({ channelCode: { booking: 'OTA_BOOKING', agoda: 'OTA_AGODA', airbnb: 'OTA_AIRBNB' }[p], roomType: t, checkIn: s.checkIn, checkOut: s.checkOut });
    }
  const t0 = Date.now();
  const sent = [];
  for (const [i, item] of plan.entries()) {
    const provider = providers[i % 3];
    sent.push(await otaSend({ provider, code: `C11-${i}`, ...item, amount: prices[`${provider}/${item.roomType}`] }));
  }
  const accepted = sent.filter((r) => r.status === 202).length;
  const { value: done, ms } = await waitFor(
    async () => {
      const rows = await sql(
        `SELECT status, count(*)::int AS n FROM webhook_inbox WHERE event_id = ANY($1) GROUP BY status`,
        [sent.map((r) => r.eventId)],
      );
      const processed = rows.find((r) => r.status === 'PROCESSED')?.n ?? 0;
      return processed === 20 ? rows : null;
    },
    { timeoutMs: 300_000, everyMs: 1000 },
  );
  const total = Date.now() - t0;
  const oversold = await sql(
    "SELECT external_ref FROM bookings WHERE external_ref LIKE '%/C11-%' AND oversold = true",
  );
  const cases = await sql('SELECT shortage_count FROM overbooking_cases WHERE room_type_id = $1 AND date = $2', [
    ids.roomType[PROPERTY].DLX,
    '2026-12-28',
  ]);
  check(
    name,
    accepted === 20 && done !== null && total <= 300_000 && oversold.length === 1 && cases.length === 1 && cases[0].shortage_count === 1,
    `accepted=${accepted} processedIn=${ms}ms total=${total}ms inbox=${JSON.stringify(done)} oversold=${JSON.stringify(oversold)} cases=${JSON.stringify(cases)}`,
  );
  // Bộ mô phỏng HB-128 thật (`scripts/simulators/ota/simulator.ts`): chạy kịch bản twenty-events và ghi kết cục.
  const sim = spawnSync(
    'node',
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { runSimulator } from './scripts/simulators/ota/simulator.ts';
       const accounts = JSON.parse(process.env.SIM_ACCOUNTS);
       const r = await runSimulator({ baseUrl: process.env.SIM_BASE, clock: new Date(Number(process.env.SIM_NOW)), seed: 194, scenario: 'twenty-events', accounts });
       console.log(JSON.stringify(r.events.map((e) => e.outcome)));`,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SIM_BASE: API_ORIGIN,
        SIM_NOW: String(serverNow()),
        SIM_ACCOUNTS: JSON.stringify(
          ['booking', 'agoda', 'airbnb'].map((provider) => ({ provider, ...OTA_ACCOUNTS[provider][0] })),
        ),
      },
    },
  );
  const outcomes = sim.status === 0 ? JSON.parse(sim.stdout.trim().split('\n').pop()) : null;
  await wait(5000);
  const simInbox = await sql(
    "SELECT status, last_error, count(*)::int AS n FROM webhook_inbox WHERE event_id LIKE 'hb128-sim-194-%' GROUP BY status, last_error",
  );
  check(
    `${name}::hb128_simulator_twenty_events_durable`,
    outcomes !== null && outcomes.filter((o) => o === 'accepted').length === 20,
    `simulator=${sim.status} outcomes=${JSON.stringify(outcomes)} ${sim.status === 0 ? '' : sim.stderr.slice(0, 300)}`,
  );
  const quarantined = simInbox.filter((r) => r.status !== 'PROCESSED').reduce((n, r) => n + r.n, 0);
  if (quarantined > 0)
    finding(
      'QA-F6-01',
      'Bộ mô phỏng HB-128 sinh sự kiện không áp được thành booking: cơ sở `H029-A`, ngày 10–12/12 và số tiền ngẫu nhiên cố định trong `rawOf()` không khớp dữ liệu/engine giá của môi trường thật, nên hàng inbox bị cách ly thay vì tạo booking.',
      `inbox=${JSON.stringify(simInbox)}`,
    );
}

/** TC-CHAN-06 cần log thuộc tính 10.000 cấu hình của backend (HB-131 AC4) — đọc thẳng test khoá trên SHA này. */
async function tc06() {
  const name = 'TC_CHAN_06_quota_properties_evidence';
  const { readFileSync } = await import('node:fs');
  const file = 'apps/api/test/channel-sync/inventory.locked.spec.ts';
  const text = readFileSync(`${repoRoot}/${file}`, 'utf8');
  const hasProperty = /numRuns\s*:\s*10[_]?000/.test(text) || /fc\.assert/.test(text);
  if (hasProperty) {
    notRun(name, `${file} có lượt thuộc tính; cần chạy riêng trong apps/api và đính log`);
    return;
  }
  finding(
    'QA-F6-03',
    'HB-131 AC4 ghi "khoá test thuộc tính 10.000 cấu hình với seed cố định theo TC-CHAN-06" nhưng `inventory.locked.spec.ts::per-channel-quota-and-nonnegative-inventory` chỉ có ca ví dụ (5 phòng, DOR 6 giường), không có fast-check/numRuns.',
    `${file}: không có numRuns/fc.assert`,
  );
  blocked(name, 'Thiếu bằng chứng thuộc tính 10.000 cấu hình của backend (QA-F6-03); phần ví dụ đã chạy thật ở TC-CHAN-01/10');
}

/** AC3 (một phần): vai trò không có quyền F6 bị chặn ở tuyến không cần ID tài nguyên; quyền đọc không cấp quyền ghi. */
async function tcRbac() {
  const name = 'rbac_projection_and_scope_matrix';
  const cases = [
    ['housekeeping', 'GET', `/channels/${ids.channel.OTA_BOOKING}/sync-status`, 403],
    ['frontdesk', 'GET', `/channels/${ids.channel.OTA_BOOKING}/sync-status`, 403],
    ['accountant', 'POST', `/channels/${ids.channel.OTA_BOOKING}/sync`, 403],
    ['manager', 'PUT', `/channels/${ids.channel.OTA_BOOKING}/mappings`, 403],
    ['frontdesk', 'GET', `/overbooking-cases?propertyId=${ids.property[PROPERTY]}`, 403],
    ['housekeeping', 'GET', `/overbooking-alerts?propertyId=${ids.property[PROPERTY]}`, 403],
    ['sysadmin', 'GET', `/overbooking-cases`, 403],
    ['manager', 'GET', `/overbooking-cases?propertyId=${ids.property[PROPERTY]}`, 200],
    ['frontdesk', 'GET', `/overbooking-alerts?propertyId=${ids.property[PROPERTY]}`, 200],
    ['manager', 'GET', `/overbooking-cases?propertyId=${ids.property['CS-03']}`, 403],
  ];
  const rows = [];
  for (const [user, method, path, expected] of cases) {
    const token = await login(user);
    const body = method === 'GET' ? undefined : method === 'PUT' ? { roomTypeId: ids.roomType[PROPERTY].STD, providerRoomTypeCode: 'STD', allotmentPct: 80 } : { scope: 'FULL' };
    const res = await api(path, { token, method, body, headers: method === 'GET' ? {} : { 'If-Match': '"0"' } });
    rows.push({ user, method, path: path.replace(/[0-9a-f-]{36}/g, ':id'), expected, got: res.status, code: res.body?.code });
  }
  const bad = rows.filter((r) => r.got !== r.expected);
  check(name, bad.length === 0, JSON.stringify(bad.length === 0 ? rows : bad));
}

const TESTS = { tc08, tc09, tc07, tc10and03, tc01, tc04, tc11, tc05, tc02, tc06, tcRbac };
try {
  // Nhịp quét đồng bộ 20 giây (mặc định seed 300 giây, BR-SYS-02 cho đổi) để 3 vòng lỗi TC-CHAN-05 chạy trong ~1 phút.
  await bootstrap({
    settings: {
      'job.channelSync.intervalSeconds': String(SYNC_INTERVAL_SECONDS),
      'chan.ota.simulator.baseUrl': receiverUrl,
      'alerts.recipient.manager': 'qa-manager@example.test',
    },
  });
  await setClock('2026-12-01', '09:00');
  const only = process.env.QA_ONLY?.split(',');
  for (const [label, fn] of Object.entries(TESTS)) {
    if (only && !only.includes(label)) continue;
    try {
      await fn();
    } catch (error) {
      check(`${label}::threw`, false, error instanceof Error ? error.message : String(error));
    }
  }
} finally {
  writeReport('chan', { sha, startedAt: started.toISOString(), finishedAt: new Date().toISOString(), receivedSnapshots: received.length });
  receiver.close();
  await teardown();
}
