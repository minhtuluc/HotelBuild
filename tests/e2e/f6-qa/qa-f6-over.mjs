#!/usr/bin/env node
/**
 * HB-194 — QA F6 phần OVER (TC-OVER-01…18) trên API + worker **thật**.
 *
 * Chạy: `REDIS_URL=redis://127.0.0.1:6379/10 node tests/e2e/f6-qa/qa-f6-over.mjs` (biến môi trường như
 * `tests/e2e/f5`). Booking vượt tồn được tạo bằng sự kiện OTA có ký (đường production duy nhất cho phép
 * booking `CONFIRMED` khi hết phòng — BR-CHAN-03); ca quá tải, thang điều chuyển, room move/walk-out và chi
 * bồi thường đi qua tuyến F6 với vai trò thật, PIN thật và `If-Match`/ETag do máy chủ trả. Số tiền (giá OTA,
 * bồi thường đêm đầu) luôn đọc từ máy chủ. Quét quá tải: `job.overbooking.scanIntervalMinutes = 1`
 * (seed 60, BR-SYS-02 cho đổi không triển khai lại).
 */
import { spawnSync } from 'node:child_process';
import {
  api,
  blocked,
  bookingOf,
  bootstrap,
  check,
  finding,
  ids,
  login,
  mintPin,
  notRun,
  otaPrice,
  otaSend,
  PROPERTY,
  repoRoot,
  setClock,
  sql,
  teardown,
  wait,
  waitFor,
  waitInbox,
  writeReport,
} from './qa-f6-lib.mjs';

const started = new Date();
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
const room = (type) => ids.roomType[PROPERTY][type];

async function otaBooking({ provider = 'booking', code, roomType, checkIn, checkOut }) {
  const channelCode = { booking: 'OTA_BOOKING', agoda: 'OTA_AGODA', airbnb: 'OTA_AIRBNB' }[provider];
  const amount = await otaPrice({ channelCode, roomType, checkIn, checkOut });
  const sent = await otaSend({ provider, code, roomType, checkIn, checkOut, amount });
  const inbox = await waitInbox(sent.eventId);
  return { inbox, booking: await bookingOf(code), amount };
}

/** `n` booking OTA cho một loại phòng/kỳ; trả các booking theo thứ tự tạo. */
async function fill(prefix, n, stay) {
  const out = [];
  for (let i = 1; i <= n; i += 1) out.push(await otaBooking({ code: `${prefix}-${i}`, ...stay }));
  return out;
}

const casesOf = async (roomType, date) =>
  sql('SELECT id, shortage_count, status, detected_at, escalated_at, resolved_at, delay_reason FROM overbooking_cases WHERE room_type_id = $1 AND date = $2', [room(roomType), date]);

async function roomMove(token, body) {
  return api('/room-moves', { token, method: 'POST', body });
}
async function moveEtag(token, id) {
  const res = await api(`/room-moves/${id}`, { token });
  return { etag: res.headers.get('etag'), body: res.body };
}
const bookingRoomOf = async (bookingId) => (await sql('SELECT id FROM booking_rooms WHERE booking_id = $1', [bookingId]))[0].id;
const activeRoomsOf = async (bookingId) =>
  (
    await sql(
      `SELECT ra.room_id FROM room_assignments ra JOIN booking_rooms br ON br.id = ra.booking_room_id
        WHERE br.booking_id = $1 AND ra.released_at IS NULL ORDER BY ra.start_date`,
      [bookingId],
    )
  ).map((r) => r.room_id);

/** Phòng trống của một loại phòng cho kỳ — do máy chủ đề xuất (relocation-options), không tự chọn. */
async function upgradeTarget(token, bookingId, caseId) {
  const res = await api(`/bookings/${bookingId}/relocation-options?overbookingCaseId=${caseId}`, { token });
  return res.body?.options?.find((o) => o.moveType === 'UPGRADE_SAME_PROPERTY' && o.feasible);
}

/** TC-OVER-01 + 04: FAM (3 phòng) — 6 booking vượt tồn trên 2 đêm ⇒ đúng 2 ca, mỗi ca thiếu 3; mở cùng transaction. */
async function over01and04() {
  const nights = [
    { roomType: 'FAM', checkIn: '2026-12-05', checkOut: '2026-12-06' },
    { roomType: 'FAM', checkIn: '2026-12-06', checkOut: '2026-12-07' },
  ];
  const sameTx = [];
  for (const [n, stay] of nights.entries()) {
    const made = await fill(`O01-${n}`, 6, stay);
    for (const m of made.filter((x) => x.booking?.oversold)) {
      // Ngay khi hàng inbox PROCESSED (trước bất kỳ lượt quét nào) ca phải tồn tại và mốc phát hiện ≤ mốc tạo booking.
      const [c] = await casesOf('FAM', stay.checkIn);
      sameTx.push({ date: stay.checkIn, booking: m.booking.code, caseExists: c !== undefined, detectedLeCreated: c ? c.detected_at <= m.booking.created_at : false });
    }
  }
  const before = await Promise.all(nights.map((s) => casesOf('FAM', s.checkIn)));
  // Một lượt quét thật nữa không được nhân ca (BR-OVER-05 gộp theo cơ sở/ngày/loại phòng).
  const manager = await login('manager');
  const scanBefore = (await api(`/overbooking-cases?propertyId=${ids.property[PROPERTY]}`, { token: manager })).body?.meta?.scan;
  const { value: scanned } = await waitFor(
    async () => {
      const scan = (await api(`/overbooking-cases?propertyId=${ids.property[PROPERTY]}`, { token: manager })).body?.meta?.scan;
      // Đọc cả khoá theo hợp đồng (`lastSuccessfulScanAt`) lẫn khoá máy chủ đang trả (`lastSuccessAt`, QA-F6-07).
      const last = scan?.lastSuccessfulScanAt ?? scan?.lastSuccessAt;
      const prev = scanBefore?.lastSuccessfulScanAt ?? scanBefore?.lastSuccessAt;
      return last && last !== prev ? scan : null;
    },
    { timeoutMs: 150_000, everyMs: 2000 },
  );
  const after = await Promise.all(nights.map((s) => casesOf('FAM', s.checkIn)));
  const shape = after.map((rows) => rows.map((r) => `${r.status}:${r.shortage_count}`));
  check(
    'TC_OVER_01_two_grouped_cases',
    after.every((rows) => rows.length === 1 && rows[0].shortage_count === 3 && rows[0].status === 'OPEN') && scanned !== null,
    `before=${JSON.stringify(before.map((r) => r.length))} after=${JSON.stringify(shape)} scanBefore=${JSON.stringify(scanBefore)} scanAfter=${JSON.stringify(scanned)}`,
  );
  // Hợp đồng `overbookingCaseListSchema.meta.scan` (HB-120 AC14) mà BFF ops-web decode.
  const scanKeys = Object.keys(scanBefore ?? {}).sort().join(',');
  const contractKeys = ['lastSuccessfulScanAt', 'nextScanAt', 'scanStatus', 'scannedThrough'].join(',');
  check('TC_OVER_01_two_grouped_cases::scan_meta_matches_contract', scanKeys === contractKeys, `server=${scanKeys} contract=${contractKeys}`);
  if (scanKeys !== contractKeys)
    finding(
      'QA-F6-07',
      '`GET /overbooking-cases` trả `meta.scan = {status, lastSuccessAt, dataAsOf}` (apps/api/src/modules/over/queries/scan-meta.ts) trong khi hợp đồng `overbookingScanMetadataSchema` là `{scanStatus, lastSuccessfulScanAt, nextScanAt, scannedThrough}`; BFF ops-web (`app/api/session/sys/f6-route.ts`) decode bằng `overbookingCaseListSchema` nên SCR-43 trên API thật không đọc được danh sách.',
      `server=${JSON.stringify(scanBefore)}`,
    );
  check(
    'TC_OVER_04_oversold_case_same_transaction',
    sameTx.length === 6 && sameTx.every((s) => s.caseExists && s.detectedLeCreated),
    JSON.stringify(sameTx),
  );
}

/**
 * TC-OVER-05/06 (thang trên dữ liệu thật) + TC-OVER-08 (nâng hạng giữ giá) + TC-OVER-18 (execute cũ giữ nguồn)
 * + TC-OVER-16 (thiếu 2: 1 nâng hạng + 1 walk-out ⇒ RESOLVED trước hạn) + TC-OVER-07 (walk-out, bồi thường do máy chủ tính).
 */
async function ladderMovesAndResolve() {
  const stay = { roomType: 'STD', checkIn: '2026-12-18', checkOut: '2026-12-19' };
  const made = await fill('O16', 10, stay); // STD tại CS-01 có 8 phòng ⇒ thiếu 2.
  const [c] = await casesOf('STD', stay.checkIn);
  const manager = await login('manager');
  const frontdesk = await login('frontdesk');
  const plan = await api(`/overbooking-cases/${c.id}/relocation-plan`, { token: manager, method: 'POST', body: { strategy: 'AUTO' } });
  const ladder = Object.fromEntries((plan.body?.ladder ?? []).map((s) => [s.moveType, s.feasible]));
  check(
    'TC_OVER_05_ladder_one_two_four',
    plan.status === 200 &&
      ladder.SAME_TYPE_SAME_PROPERTY === false &&
      ladder.UPGRADE_SAME_PROPERTY === true &&
      ladder.WALK_OUT === true &&
      plan.body?.assignmentsChanged === false,
    `plan=${plan.status} ladder=${JSON.stringify(plan.body?.ladder?.map((s) => [s.step, s.moveType, s.feasible, s.note ?? '']))}`,
  );
  const cross = (plan.body?.ladder ?? []).filter((s) => s.moveType.endsWith('CROSS_PROPERTY'));
  check(
    'TC_OVER_06_cross_property_permission',
    cross.length > 0 && cross.every((s) => s.feasible === false),
    `cross=${JSON.stringify(cross)} (dữ liệu thật: ba cơ sở cách 160–300 km)`,
  );
  // Bảng ưu tiên đủ thành phần, nhóm và mốc tạo trước khi xác nhận (TC-OVER-10 phần API).
  const cands = plan.body?.candidates ?? [];
  const complete = cands.length === 10 && cands.every((x) => x.keepScore !== undefined && x.priorityGroup && x.createdAt && x.bookingSeq && x.rank);
  const ranks = cands.map((x) => x.rank);
  check(
    'TC_OVER_10_complete_score_table_evidence::api_table',
    complete && JSON.stringify(ranks) === JSON.stringify([...ranks].sort((a, b) => a - b)),
    `candidates=${cands.length} sample=${JSON.stringify(cands[0])}`,
  );

  // Hai khách đầu bảng (keepScore thấp nhất theo thứ tự máy chủ) là đối tượng điều chuyển (TC-OVER-16).
  const [first, second] = cands;
  const upgrade = await upgradeTarget(frontdesk, first.bookingId, c.id);
  const totalBefore = (await sql('SELECT total_amount::text AS t FROM bookings WHERE id = $1', [first.bookingId]))[0].t;
  const sourceRooms = await activeRoomsOf(first.bookingId);

  // TC-OVER-18: đề xuất nâng hạng vào phòng X, rồi phòng X bị lấy trước (một move khác execute) ⇒ execute cũ thất bại, nguồn giữ.
  const stale = await roomMove(frontdesk, {
    overbookingCaseId: c.id,
    bookingId: second.bookingId,
    bookingRoomId: second.bookingRoomId,
    moveType: 'UPGRADE_SAME_PROPERTY',
    toRoomId: upgrade?.targetRoomId,
    reason: 'HB-194 TC-OVER-18 đề xuất cũ',
    compensationAmount: 0,
    transportCost: 0,
    consent: { granted: true, channel: 'IN_PERSON' },
  });
  const staleEtag = stale.status === 201 ? await moveEtag(frontdesk, stale.body.id) : null;

  // TC-OVER-08: nâng hạng STD → DLX cho khách đầu bảng, giữ giá.
  const move = await roomMove(frontdesk, {
    overbookingCaseId: c.id,
    bookingId: first.bookingId,
    bookingRoomId: first.bookingRoomId,
    moveType: 'UPGRADE_SAME_PROPERTY',
    toRoomId: upgrade?.targetRoomId,
    reason: 'HB-194 TC-OVER-08 nâng hạng',
    compensationAmount: 0,
    transportCost: 0,
    consent: { granted: true, channel: 'IN_PERSON' },
  });
  const statuses = [move.body?.status];
  let executed = null;
  if (move.status === 201) {
    if (move.body.allowedActions?.includes('APPROVE')) {
      const e = await moveEtag(manager, move.body.id);
      const ap = await api(`/room-moves/${move.body.id}/approve`, {
        token: manager,
        method: 'POST',
        headers: { 'If-Match': e.etag },
        body: { compensationAmount: 0, transportCost: 0, pinToken: await mintPin('manager', first.bookingId) },
      });
      statuses.push(ap.body?.status ?? `HTTP${ap.status}`);
    }
    const e = await moveEtag(frontdesk, move.body.id);
    executed = await api(`/room-moves/${move.body.id}/execute`, {
      token: frontdesk,
      method: 'POST',
      headers: { 'If-Match': e.etag },
      body: { pinToken: await mintPin('frontdesk', first.bookingId) },
    });
    statuses.push(executed.body?.status ?? `HTTP${executed.status}`);
  }
  const totalAfter = (await sql('SELECT total_amount::text AS t FROM bookings WHERE id = $1', [first.bookingId]))[0].t;
  const targetRooms = await activeRoomsOf(first.bookingId);
  const audits = (await sql('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY chain_seq', [move.body?.id])).map((r) => r.action);
  const executedAt = Date.now();
  const { value: notices, ms: noticeMs } = await waitFor(
    async () => {
      const rows = await sql('SELECT template, channel, status, created_at FROM notifications WHERE booking_id = $1 ORDER BY created_at', [first.bookingId]);
      return rows.length > 0 ? rows : null;
    },
    { timeoutMs: 120_000, everyMs: 2000 },
  );
  const outbox = await sql('SELECT event_type, status FROM outbox_events WHERE aggregate_id::text = $1 OR payload_json::text LIKE $2', [move.body?.id, `%${move.body?.id}%`]).catch((e) => [{ error: e.message }]);
  check(
    'TC_OVER_08_price_lock_notification_15m',
    executed?.status === 200 &&
      executed.body?.status === 'EXECUTED' &&
      executed.body?.priceLocked === true &&
      totalBefore === totalAfter &&
      targetRooms.includes(upgrade?.targetRoomId) &&
      !targetRooms.some((r) => sourceRooms.includes(r)) &&
      audits.length >= 2 &&
      notices !== null,
    `statuses=${JSON.stringify(statuses)} exec=${executed?.status} total=${totalBefore}->${totalAfter} rooms=${JSON.stringify(sourceRooms)}->${JSON.stringify(targetRooms)} audits=${JSON.stringify(audits)} notifications=${JSON.stringify(notices)} afterMs=${noticeMs} outbox=${JSON.stringify(outbox)}`,
  );
  if (!statuses.includes('APPROVED'))
    finding(
      'QA-F6-04',
      'Nâng hạng không chi phí đi thẳng PROPOSED → EXECUTED (`allowedActions` chỉ có EXECUTE), không qua APPROVED như TC-OVER-08 mô tả; khớp chuyên đề §10.3/F6-D04 (duyệt chỉ khi có chi phí) nhưng kế hoạch kiểm thử chưa cập nhật.',
      `statuses=${JSON.stringify(statuses)}`,
    );
  if (notices === null)
    finding(
      'QA-F6-10',
      'BR-OVER-10: RoomMove nâng hạng EXECUTED nhưng không có thông báo cho khách trong 2 phút (bảng `notifications` trống cho booking; execute chỉ ghi outbox `InventoryChanged`, không có đường gửi thông báo khách).',
      `outbox=${JSON.stringify(outbox)}`,
    );
  if (move.body && (move.body.overbookingCaseId === null || move.body.consent === null))
    finding(
      'QA-F6-05',
      '`POST /room-moves` nhận `overbookingCaseId` và `consent` nhưng phản hồi/đọc lại trả `null`: bảng `room_moves` không có cột lưu hai trường này, nên liên kết ca và bằng chứng đồng ý của khách bị mất.',
      `overbookingCaseId=${move.body.overbookingCaseId} consent=${JSON.stringify(move.body.consent)}`,
    );

  // TC-OVER-18: execute đề xuất cũ vào phòng đã bị lấy ⇒ thất bại, phòng nguồn của khách thứ hai giữ nguyên.
  const secondRoomsBefore = await activeRoomsOf(second.bookingId);
  const staleExec = staleEtag
    ? await api(`/room-moves/${stale.body.id}/execute`, {
        token: frontdesk,
        method: 'POST',
        headers: { 'If-Match': staleEtag.etag },
        body: { pinToken: await mintPin('frontdesk', second.bookingId) },
      })
    : null;
  const secondRoomsAfter = await activeRoomsOf(second.bookingId);
  const [caseMid] = await casesOf('STD', stay.checkIn);
  check(
    'TC_OVER_18_stale_execute_keeps_source',
    staleExec !== null &&
      staleExec.status >= 400 &&
      JSON.stringify(secondRoomsBefore) === JSON.stringify(secondRoomsAfter) &&
      caseMid.status !== 'RESOLVED',
    `stale=${stale.status} exec=${staleExec?.status} ${staleExec?.body?.code ?? ''} rooms=${JSON.stringify(secondRoomsBefore)}->${JSON.stringify(secondRoomsAfter)} case=${caseMid.status}`,
  );

  // TC-OVER-07 + 16: walk-out khách thứ hai — bồi thường đêm đầu do máy chủ tính, MANAGER duyệt (PIN), lễ tân thực hiện, kế toán chi.
  const options = await api(`/bookings/${second.bookingId}/relocation-options?overbookingCaseId=${c.id}`, { token: frontdesk });
  const walk = options.body?.options?.find((o) => o.moveType === 'WALK_OUT');
  const firstNight = (await sql('SELECT price_per_night::text AS p FROM booking_rooms WHERE booking_id = $1', [second.bookingId]))[0].p;
  const paid = (await sql('SELECT paid_amount::text AS p FROM bookings WHERE id = $1', [second.bookingId]))[0].p;
  // Dò hợp đồng: body đúng `roomMoveCreateRequestSchema` (walkOut lồng nhau, như SCR-44 gửi) cho khách thứ ba — chỉ tạo, không duyệt.
  const third = cands[2];
  const walkOutDoc = { walkOutDocNo: 'WO-HB194-01', guestSignatureRef: 'sig-guest-hb194', staffSignatureRef: 'sig-staff-hb194' };
  const contractShape = await roomMove(frontdesk, {
    overbookingCaseId: c.id,
    bookingId: third.bookingId,
    bookingRoomId: third.bookingRoomId,
    moveType: 'WALK_OUT',
    reason: 'HB-194 dò hợp đồng walk-out',
    compensationAmount: walk?.compensationAmount ?? 0,
    transportCost: 0,
    consent: { granted: true, channel: 'IN_PERSON' },
    walkOut: { ...walkOutDoc, walkOutDocNo: 'WO-HB194-CONTRACT', refundRequestId: null, compensationPaymentId: null },
  });
  const contractRow = contractShape.body?.id
    ? (await sql('SELECT walk_out_doc_no FROM room_moves WHERE id = $1', [contractShape.body.id]))[0]
    : null;
  const contractKeepsEvidence = contractRow?.walk_out_doc_no === 'WO-HB194-CONTRACT';
  check(
    'TC_OVER_07_walkout_amount_documents::contract_body_keeps_evidence',
    contractShape.status === 201 && contractKeepsEvidence,
    `create=${contractShape.status} stored=${JSON.stringify(contractRow)} body.walkOut=${JSON.stringify(contractShape.body?.walkOut)}`,
  );
  // Luồng nghiệp vụ đầy đủ cho khách thứ hai bằng dạng body máy chủ đang nhận (trường phẳng, như test khoá HB-124).
  const wo = await roomMove(frontdesk, {
    overbookingCaseId: c.id,
    bookingId: second.bookingId,
    bookingRoomId: second.bookingRoomId,
    moveType: 'WALK_OUT',
    reason: 'HB-194 TC-OVER-07 walk-out',
    compensationAmount: walk?.compensationAmount ?? 0,
    transportCost: 0,
    consent: { granted: true, channel: 'IN_PERSON' },
    ...(contractKeepsEvidence ? { walkOut: { ...walkOutDoc, refundRequestId: null, compensationPaymentId: null } } : walkOutDoc),
  });
  const woFlow = [wo.body?.status ?? `HTTP${wo.status}:${wo.body?.code}`];
  // Lễ tân không được tự execute trước khi MANAGER duyệt chi phí (BR-OVER-06).
  let earlyExec = null;
  if (wo.status === 201) {
    const e0 = await moveEtag(frontdesk, wo.body.id);
    earlyExec = await api(`/room-moves/${wo.body.id}/execute`, {
      token: frontdesk,
      method: 'POST',
      headers: { 'If-Match': e0.etag },
      body: { pinToken: await mintPin('frontdesk', second.bookingId) },
    });
    const e1 = await moveEtag(manager, wo.body.id);
    const ap = await api(`/room-moves/${wo.body.id}/approve`, {
      token: manager,
      method: 'POST',
      headers: { 'If-Match': e1.etag },
      body: { compensationAmount: walk?.compensationAmount ?? 0, transportCost: 0, pinToken: await mintPin('manager', second.bookingId) },
    });
    woFlow.push(ap.body?.status ?? `HTTP${ap.status}:${ap.body?.code}`);
    const e2 = await moveEtag(frontdesk, wo.body.id);
    const ex = await api(`/room-moves/${wo.body.id}/execute`, {
      token: frontdesk,
      method: 'POST',
      headers: { 'If-Match': e2.etag },
      body: { pinToken: await mintPin('frontdesk', second.bookingId) },
    });
    woFlow.push(ex.body?.status ?? `HTTP${ex.status}:${ex.body?.code}`);
  }
  const woRow = wo.body?.id ? (await sql('SELECT status, compensation_amount::text AS c, walk_out_doc_no, guest_signature_ref, staff_signature_ref, approved_by FROM room_moves WHERE id = $1', [wo.body.id]))[0] : null;
  const accountant = await login('accountant');
  const pay = wo.body?.id
    ? await api(`/room-moves/${wo.body.id}/compensation-payments`, {
        token: accountant,
        method: 'POST',
        body: { method: 'CASH', note: 'HB-194 chi bồi thường walk-out', pinToken: await mintPin('accountant', second.bookingId) },
      })
    : null;
  const compPayments = await sql("SELECT type, method, status, amount::text AS a FROM payments WHERE booking_id = $1 AND type = 'COMPENSATION'", [second.bookingId]).catch((e) => [{ error: e.message }]);
  check(
    'TC_OVER_07_walkout_amount_documents',
    walk?.feasible === true &&
      String(walk?.compensationAmount) === firstNight &&
      earlyExec !== null &&
      earlyExec.status >= 400 &&
      woFlow.at(-1) === 'EXECUTED' &&
      woRow?.walk_out_doc_no === 'WO-HB194-01' &&
      woRow?.approved_by !== null &&
      pay !== null &&
      [200, 201].includes(pay.status),
    `firstNight=${firstNight} paid=${paid} option=${JSON.stringify(walk)} earlyExec=${earlyExec?.status}:${earlyExec?.body?.code} flow=${JSON.stringify(woFlow)} row=${JSON.stringify(woRow)} pay=${pay?.status}:${pay?.body?.code ?? ''} compensation=${JSON.stringify(compPayments)}`,
  );
  if (!contractKeepsEvidence)
    finding(
      'QA-F6-06',
      'Walk-out gửi đúng hợp đồng `roomMoveCreateRequestSchema` (`walkOut: {walkOutDocNo, guestSignatureRef, staffSignatureRef, …}` — cũng là body SCR-44 ops-web `hb136-scr44-dieu-chuyen/model.ts::moveRequest`) bị server bỏ êm phần `walkOut`: `moves/validation.ts` chỉ đọc trường phẳng `walkOutDocNo`… (khớp test khoá HB-124), nên `execute` luôn 409 E_OVER_MOVE_NOT_ALLOWED "Walk-out phải có biên bản…". Walk-out từ giao diện thật không thực thi được.',
      `contractShape=${JSON.stringify(contractRow)} flatShapeRow=${JSON.stringify(woRow)}`,
    );
  blocked(
    'TC_OVER_07_walkout_amount_documents::refund_100pct_paid',
    'Hoàn 100% số đã trả khi walk-out: xem trước gross/net/phí chưa có tuyến (TD-77, HB-137 BLOCKED chạm tiền) — chỉ kiểm bồi thường đêm đầu và chứng từ',
  );

  // TC-OVER-16: sau 1 nâng hạng + 1 walk-out, ca thiếu 2 phải RESOLVED trước hạn T−24h.
  const { value: resolved } = await waitFor(
    async () => {
      const [row] = await casesOf('STD', stay.checkIn);
      return row?.status === 'RESOLVED' ? row : null;
    },
    { timeoutMs: 150_000, everyMs: 2000 },
  );
  const [caseEnd] = await casesOf('STD', stay.checkIn);
  const detail = (await api(`/overbooking-cases/${c.id}`, { token: manager })).body;
  check(
    'TC_OVER_16_upgrade_walkout_resolve',
    resolved !== null && first.rank === 1 && second.rank === 2 && new Date(caseEnd.resolved_at) < new Date(detail.resolveDeadline),
    `case=${JSON.stringify(caseEnd)} deadline=${detail?.resolveDeadline} source=${detail?.resolutionSource} ranks=${first.rank},${second.rank}`,
  );
  return { made };
}

/** TC-OVER-02 + 17: ca chưa xử lý quá T−24h ⇒ ESCALATED; qua ngày thiếu phòng vẫn ESCALATED, giữ mốc, không tự đóng. */
async function escalation() {
  const stay = { roomType: 'SUP', checkIn: '2026-12-03', checkOut: '2026-12-04' };
  await fill('O02', 7, stay); // SUP tại CS-01 có 6 phòng ⇒ thiếu 1.
  const [c] = await casesOf('SUP', stay.checkIn);
  const owner = await login('owner');
  const deadline = (await api(`/overbooking-cases/${c.id}`, { token: owner })).body?.resolveDeadline;
  // Đẩy đồng hồ qua T−24h (02/12 14:00 VN) rồi chờ một lượt quét thật.
  await setClock('2026-12-02', '15:00');
  const { value: esc } = await waitFor(
    async () => {
      const [row] = await casesOf('SUP', stay.checkIn);
      return row?.status === 'ESCALATED' ? row : null;
    },
    { timeoutMs: 180_000, everyMs: 3000 },
  );
  const ownerToken = await login('owner');
  const view = (await api(`/overbooking-cases/${c.id}?includeCandidates=true`, { token: ownerToken })).body;
  const overdueList = (await api(`/overbooking-cases?propertyId=${ids.property[PROPERTY]}&overdueOnly=true`, { token: ownerToken })).body;
  const ownerAlerts = await sql("SELECT action FROM audit_logs WHERE entity_id = $1 AND action ILIKE '%ESCALAT%'", [c.id]);
  const detailKeys = Object.keys(view ?? {});
  const missing = ['history', 'candidates'].filter((k) => !detailKeys.includes(k));
  const candidateKeys = Object.keys(view?.candidates?.[0] ?? {});
  const contractCandidate = ['rank', 'bookingId', 'bookingRoomId', 'bookingSeq', 'guestNameMasked', 'channelCode', 'status', 'checkIn', 'checkOut', 'nights', 'adults', 'children', 'keepScore', 'priorityGroup', 'createdAt', 'paidAmount', 'depositAmount', 'totalAmount'];
  const candidateMissing = contractCandidate.filter((k) => view?.candidates?.length && !candidateKeys.includes(k));
  check(
    'TC_OVER_02_deadline_escalation::case_detail_matches_contract',
    missing.length === 0 && candidateMissing.length === 0,
    `missing=${JSON.stringify(missing)} candidateMissing=${JSON.stringify(candidateMissing)} candidateKeys=${JSON.stringify(candidateKeys)}`,
  );
  if (missing.length > 0 || candidateMissing.length > 0)
    finding(
      'QA-F6-08',
      '`GET /overbooking-cases/{id}` không khớp `overbookingCaseDetailSchema`: thiếu `history` (mốc DETECTED/ESCALATED/RESOLVED) và `candidates` có hình dạng khác `relocationCandidateSchema` (thiếu rank, guestNameMasked, kỳ ở, tiền…).',
      `missing=${JSON.stringify(missing)} candidateMissing=${JSON.stringify(candidateMissing)}`,
    );
  check(
    'TC_OVER_02_deadline_escalation',
    esc !== null && esc.escalated_at !== null && view?.status === 'ESCALATED' && view?.overdue === true && overdueList?.meta?.overdueCount >= 1,
    `deadline=${deadline} keys=${Object.keys(view ?? {}).join(',')} case=${JSON.stringify(esc)} overdue=${view?.overdue} history=${JSON.stringify(view?.history?.map((h) => h.action))} overdueCount=${overdueList?.meta?.overdueCount} audits=${JSON.stringify(ownerAlerts)}`,
  );
  // Qua hẳn ngày thiếu phòng: không tự đóng, giữ detectedAt/escalatedAt.
  await setClock('2026-12-04', '10:00');
  await wait(75_000); // hơn một nhịp quét 1 phút
  const [late] = await casesOf('SUP', stay.checkIn);
  const lateView = (await api(`/overbooking-cases/${c.id}`, { token: await login('owner') })).body;
  check(
    'TC_OVER_17_past_date_stays_escalated',
    late.status === 'ESCALATED' &&
      String(late.detected_at) === String(esc?.detected_at) &&
      String(late.escalated_at) === String(esc?.escalated_at) &&
      late.resolved_at === null &&
      lateView?.status === 'ESCALATED',
    `before=${JSON.stringify(esc)} after=${JSON.stringify(late)}`,
  );
}

/** Ca cần bằng chứng engine/thuộc tính của backend: chạy đúng test domain trên SHA này và đính kết quả. */
function domainEvidence() {
  const run = spawnSync(
    'pnpm',
    ['--filter', '@pinehill/domain', 'exec', 'vitest', 'run', 'test/overbooking', '--reporter=json'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  let report = null;
  try {
    report = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
  } catch {
    report = null;
  }
  const files = report?.testResults ?? [];
  const byName = (re) =>
    files.flatMap((f) => f.assertionResults.filter((a) => re.test(`${f.name} ${a.fullName}`)).map((a) => ({ file: f.name.replace(`${repoRoot}/`, ''), name: a.fullName, status: a.status })));
  const props = byName(/planner-properties/);
  check(
    'TC_OVER_10_complete_score_table_evidence::domain_10000',
    run.status === 0 && props.length > 0 && props.every((p) => p.status === 'passed'),
    `vitest=${run.status} tests=${report?.numPassedTests}/${report?.numTotalTests} planner-properties=${JSON.stringify(props.map((p) => p.name))}`,
  );
  const limits = byName(/limit|ceil|trần|E_OVER_LIMIT/i);
  check(
    'TC_OVER_03_server_limits::domain_engine',
    run.status === 0 && limits.length > 0 && limits.every((p) => p.status === 'passed'),
    `limit tests=${JSON.stringify(limits.map((p) => `${p.file}::${p.name}`).slice(0, 8))}`,
  );
  const geo = byName(/15 ?km|cross|bậc 3|radius|bán kính/i);
  check(
    'TC_OVER_05_ladder_one_two_four::domain_12km_variant',
    run.status === 0 && geo.length > 0 && geo.every((p) => p.status === 'passed'),
    `geo tests=${JSON.stringify(geo.map((p) => `${p.file}::${p.name}`).slice(0, 6))}`,
  );
}

/** Khách tại quầy có giới tính (chỉ `POST /guests` nhận `gender`); booking OTA cùng SĐT dùng lại hồ sơ này. */
async function guestWith(token, phone, gender) {
  const res = await api('/guests', {
    token,
    method: 'POST',
    body: { fullName: `QA F6 ${gender} ${phone.slice(-4)}`, phone, gender, consentMarketing: false, consentVersion: '2026-10' },
  });
  if (![200, 201].includes(res.status)) throw new Error(`POST /guests → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function dorBooking(code, phone, date) {
  const stay = { roomType: 'DOR', checkIn: date, checkOut: nextDay(date) };
  const amount = await otaPrice({ channelCode: 'OTA_BOOKING', ...stay });
  const sent = await otaSend({ code, ...stay, amount, phone, adults: 2 });
  const inbox = await waitInbox(sent.eventId);
  return { inbox, booking: await bookingOf(code) };
}
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function mergeFlow(frontdesk, primary, secondary, roomId) {
  return api('/room-merges', {
    token: frontdesk,
    method: 'POST',
    body: { moveType: 'MERGE_SHARE', primaryBookingId: primary, secondaryBookingId: secondary, roomId },
  });
}
async function mergeEtag(token, id) {
  const res = await api(`/room-merges/${id}`, { token });
  return { etag: res.headers.get('etag'), body: res.body };
}
async function consent(token, id, side) {
  const e = await mergeEtag(token, id);
  return api(`/room-merges/${id}/consent`, { token, method: 'POST', headers: { 'If-Match': e.etag }, body: { side, consented: true } });
}
async function executeMerge(token, id, bookingId) {
  const e = await mergeEtag(token, id);
  return api(`/room-merges/${id}/execute`, {
    token,
    method: 'POST',
    headers: { 'If-Match': e.etag },
    body: { pinToken: await mintPin('frontdesk', bookingId) },
  });
}

/** TC-OVER-13 (mã lỗi consent/giới tính) + TC-OVER-14 (doanh thu phòng giữ nguyên, chiết khấu tách riêng). */
async function merges() {
  const frontdesk = await login('frontdesk');
  const manager = await login('manager');
  const [dorRoom] = await sql("SELECT r.id FROM rooms r WHERE r.room_type_id = $1 ORDER BY r.code LIMIT 1", [room('DOR')]);
  const phones = { f: '+84901940001', m: '+84901940002', u: '+84901940003', f2: '+84901940004' };
  await guestWith(frontdesk, phones.f, 'FEMALE');
  await guestWith(frontdesk, phones.m, 'MALE');
  await guestWith(frontdesk, phones.u, 'UNSPECIFIED');
  await guestWith(frontdesk, phones.f2, 'FEMALE');
  const date = '2026-12-09';
  const F = await dorBooking('O13-F', phones.f, date);
  const M = await dorBooking('O13-M', phones.m, date);
  const U = await dorBooking('O13-U', phones.u, date);
  const F2 = await dorBooking('O13-F2', phones.f2, date);
  const steps = {};

  // (1b) thiếu một consent ⇒ E_OVER_NO_CONSENT.
  const m1 = await mergeFlow(frontdesk, F.booking.id, M.booking.id, dorRoom.id);
  steps.create = `${m1.status}:${m1.body?.status ?? m1.body?.code}`;
  if (m1.status === 201) {
    await consent(frontdesk, m1.body.id, 'PRIMARY');
    const oneSide = await executeMerge(frontdesk, m1.body.id, F.booking.id);
    steps.oneConsent = `${oneSide.status}:${oneSide.body?.code ?? oneSide.body?.status}`;
    // (1) đủ hai consent, khác giới, chưa MANAGER duyệt ⇒ E_OVER_MERGE_GENDER.
    await consent(frontdesk, m1.body.id, 'SECONDARY');
    const noApproval = await executeMerge(frontdesk, m1.body.id, F.booking.id);
    steps.mixedNoApproval = `${noApproval.status}:${noApproval.body?.code ?? noApproval.body?.status}`;
    // (2) MANAGER duyệt kèm lý do ⇒ thực thi được.
    const e = await mergeEtag(manager, m1.body.id);
    const ap = await api(`/room-merges/${m1.body.id}/approve`, {
      token: manager,
      method: 'POST',
      headers: { 'If-Match': e.etag },
      // ApiClient gắn `pinToken` vào body lệnh có PIN (packages/api-client/src/client.ts::buildBody) — hợp đồng chưa khai.
      body: { reason: 'HB-194 khách đồng ý ghép khác giới, có biên bản', pinToken: await mintPin('manager', F.booking.id) },
    });
    steps.approve = `${ap.status}:${ap.body?.status ?? ap.body?.code}`;
    const ok = await executeMerge(frontdesk, m1.body.id, F.booking.id);
    steps.execute = `${ok.status}:${ok.body?.status ?? ok.body?.code}`;
    steps.discount = { pct: ok.body?.discountPct, amount: ok.body?.discountAmount, priceLocked: ok.body?.priceLocked };
  }
  // (3) UNSPECIFIED + đủ consent, không duyệt ⇒ vẫn E_OVER_MERGE_GENDER.
  const m3 = await mergeFlow(frontdesk, U.booking.id, F2.booking.id, dorRoom.id);
  if (m3.status === 201) {
    await consent(frontdesk, m3.body.id, 'PRIMARY');
    await consent(frontdesk, m3.body.id, 'SECONDARY');
    const r = await executeMerge(frontdesk, m3.body.id, U.booking.id);
    steps.unspecified = `${r.status}:${r.body?.code ?? r.body?.status}`;
  } else steps.unspecified = `create ${m3.status}:${m3.body?.code}`;
  check(
    'TC_OVER_13_consent_gender_codes',
    steps.oneConsent?.endsWith('E_OVER_NO_CONSENT') &&
      steps.mixedNoApproval?.endsWith('E_OVER_MERGE_GENDER') &&
      steps.execute?.startsWith('200') &&
      steps.unspecified?.endsWith('E_OVER_MERGE_GENDER'),
    JSON.stringify(steps),
  );
  // TC-OVER-14 (BR-OVER-15): doanh thu ghi nhận = tổng gộp PriceSnapshot ORIGINAL (định nghĩa của test khoá
  // HB-124 `merge.locked.spec.ts`), phải giữ nguyên; chiết khấu ghi ở merge; nghĩa vụ phải thu giảm (floor 1.000).
  const gross = async (id) =>
    (await sql("SELECT gross_amount::text AS g FROM price_snapshots WHERE booking_id = $1 AND kind = 'ORIGINAL'", [id]))[0]?.g;
  const totals = await sql(
    'SELECT id, total_amount::text AS t, paid_amount::text AS paid, balance_due::text AS due FROM bookings WHERE id = ANY($1) ORDER BY external_ref',
    [[F.booking.id, M.booking.id]],
  );
  const grossAfter = [await gross(F.booking.id), await gross(M.booking.id)];
  const before = [F.booking, M.booking].map((b) => String(b.total_amount));
  const expectedDiscount = Math.floor((Number(F.booking.total_amount) + Number(M.booking.total_amount)) * 0.2);
  check(
    'TC_OVER_14_revenue_unchanged',
    steps.execute?.startsWith('200') &&
      JSON.stringify(grossAfter) === JSON.stringify(before) &&
      steps.discount?.pct === 20 &&
      steps.discount?.amount === expectedDiscount,
    `snapshotGross=${JSON.stringify(grossAfter)} totalsBefore=${JSON.stringify(before)} after=${JSON.stringify(totals.map(({ t, paid, due }) => ({ t, paid, due })))} discount=${JSON.stringify(steps.discount)} expected20pct=${expectedDiscount}`,
  );
  const overpaid = totals.filter((r) => Number(r.paid) > Number(r.t));
  const refunds = await sql('SELECT count(*)::int AS n FROM refund_requests WHERE booking_id = ANY($1)', [[F.booking.id, M.booking.id]]);
  if (steps.execute?.startsWith('200') && overpaid.length > 0 && refunds[0].n === 0)
    finding(
      'QA-F6-13',
      `Sau ghép MERGE_SHARE nghĩa vụ phải thu giảm (\`total_amount\` ${before.join('/')} → ${totals.map((r) => r.t).join('/')}) nhưng khách đã trả đủ giá cũ: \`paid_amount\` > \`total_amount\`, \`balance_due\` = 0 và không có \`refund_requests\` — phần chiết khấu khách được hưởng không có đường hoàn/đối soát. Mức giảm thực (${before.reduce((n, t) => n + Number(t), 0) - totals.reduce((n, r) => n + Number(r.t), 0)}) cũng lệch \`discountAmount\` ${steps.discount?.amount} do làm tròn nghĩa vụ xuống 1.000.`,
      JSON.stringify(totals.map(({ t, paid, due }) => ({ t, paid, due }))),
    );
}

const TESTS = { over01and04, ladderMovesAndResolve, merges, escalation };
try {
  process.env.QA_OUTBOX_RELAY_SECONDS ??= '2';
  await bootstrap({ settings: { 'job.overbooking.scanIntervalMinutes': '1' } });
  await setClock('2026-12-01', '09:00');
  // Kế toán của seed chỉ có phạm vi CS-03; cấp thêm CS-01 qua đúng tuyến OWNER (`PUT /users/{id}/access`).
  const owner = await login('owner');
  const [acc] = await sql("SELECT id FROM users WHERE username = 'accountant'");
  const accRow = (await api('/users?q=accountant', { token: owner })).body?.data?.find((u) => u.id === acc.id);
  const access = await api(`/users/${acc.id}/access`, {
    token: owner,
    method: 'PUT',
    headers: { 'If-Match': `"${accRow?.version}"` },
    body: { role: 'ACCOUNTANT', propertyScope: [ids.property['CS-01'], ids.property['CS-03']], isActive: true },
  });
  if (![200, 204].includes(access.status)) finding('QA-OVER-SETUP', 'Không cấp được phạm vi CS-01 cho kế toán', `${access.status} ${JSON.stringify(access.body)}`);
  const only = process.env.QA_ONLY?.split(',');
  for (const [label, fn] of Object.entries(TESTS)) {
    if (only && !only.includes(label)) continue;
    try {
      await fn();
    } catch (error) {
      check(`${label}::threw`, false, error instanceof Error ? `${error.message}\n${error.stack?.split('\n').slice(1, 3).join(' ')}` : String(error));
    }
  }
  if (!only || only.includes('domain')) domainEvidence();
  for (const [name, reason] of [
    ['TC_OVER_09_checked_in_force_majeure', 'Chưa dựng booking CHECKED_IN qua tuyến check-in thật trong lượt này; bằng chứng hiện có ở test khoá HB-124/125 (apps/api/test/over-*)'],
  ])
    notRun(name, reason);
  blocked('TC_OVER_11_two_consents_share', 'BR-OVER-14 consent hai bên cùng giới: chưa sửa DDL (ticket HB-194 dòng TC-OVER-11)');
  blocked('TC_OVER_12_connecting_contract_gate', 'Mô hình MERGE_CONNECTING chờ lead chốt (F6-D01)');
  blocked('TC_OVER_15_two_tiers_30s', 'Không có thiết bị Android/emulator/Maestro trên host (TD-78)');
} finally {
  writeReport('over', { sha, startedAt: started.toISOString(), finishedAt: new Date().toISOString() });
  await teardown();
}
