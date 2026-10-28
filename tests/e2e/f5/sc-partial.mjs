/**
 * HB-117 §5/§6 — huỷ MỘT PHẦN booking nhiều phòng (TC-BOOK-26/27; BR-CANCEL-19, BR-CANCEL-17, BR-BOOK-11, BR-RATE-16) và đổi ngày
 * (BR-BOOK-12, BR-CANCEL-08, BR-RATE-16). Số kỳ vọng tính độc lập từ dữ liệu `booking_rooms`/`price_snapshots` + quy tắc.
 */
import { createHash } from 'node:crypto';
import {
  addDays, bookingRow, call, check, ceil1000, ctx, errCode, finding, floor1000, login, makeBooking, money, num, realClock, refundRows, sql, vn,
} from './qa-f5-ctx.mjs';
import { cancelAs } from './sc-refund.mjs';

const D0 = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
let k = 0;
const far = () => addDays(D0, 150 + (k += 5));
const md5 = (v) => createHash('md5').update(JSON.stringify(v)).digest('hex');
const snapshots = (id) => sql('SELECT seq, kind, payload_json, gross_amount FROM price_snapshots WHERE booking_id = $1::uuid ORDER BY seq', [id]);
const activeAssignments = async (id) => num((await sql(`SELECT count(*)::int AS n FROM room_assignments a JOIN booking_rooms br ON br.id = a.booking_room_id WHERE br.booking_id = $1::uuid AND a.released_at IS NULL`, [id]))[0].n);

/** Phân bổ `paid` theo trọng số giá phòng–đêm: làm tròn xuống, phần dư gán theo bookingRoomId tăng dần (BR-CANCEL-19). */
function allocate(paid, weights) {
  const total = weights.reduce((a, b) => a + b, 0n);
  const base = weights.map((w) => (paid * w) / total);
  let rest = paid - base.reduce((a, b) => a + b, 0n);
  for (let i = 0; i < base.length && rest > 0n; i += 1, rest -= 1n) base[i] += 1n;
  return base;
}

export async function scenarioPartialCancel() {
  const from = far();
  const b = await makeBooking('PART-2R', { plan: 'FLEX7', type: 'DLX', from, to: addDays(from, 3), rooms: 2 });
  const rooms = await sql('SELECT id, price_per_night FROM booking_rooms WHERE booking_id = $1::uuid ORDER BY id', [b.id]);
  check('PART-2R: booking 2 phòng có 2 BookingRoom và 2 assignment hoạt động (BR-BOOK-10)', rooms.length === 2 && (await activeAssignments(b.id)) === 2, `rooms=${rooms.length}`);
  const weights = rooms.map((r) => BigInt(r.price_per_night) * BigInt(b.nights));
  const shares = allocate(BigInt(b.paid), weights);
  const before = await snapshots(b.id);
  check('PART-2R: có snapshot ORIGINAL (BR-RATE-16)', before.length === 1 && before[0].kind === 'ORIGINAL', JSON.stringify(before.map((s) => [s.seq, s.kind])));
  const originalHash = md5(before[0].payload_json);
  const shareOf = Object.fromEntries(rooms.map((r, i) => [r.id, shares[i]]));
  // Số tiền cọc thực sự gán cho từng phòng trong sổ cái (payment_allocations → booking_charges.booking_room_id).
  const alloc = await sql(`SELECT c.booking_room_id AS room, coalesce(sum(pa.amount), 0)::bigint AS amount FROM booking_charges c LEFT JOIN payment_allocations pa ON pa.charge_id = c.id WHERE c.booking_id = $1::uuid GROUP BY c.booking_room_id`, [b.id]);
  const allocOf = Object.fromEntries(alloc.map((r) => [r.room, BigInt(r.amount)]));
  const [small, big] = [...rooms].sort((x, y) => Number(allocOf[x.id] - allocOf[y.id]));
  const token = await login('frontdesk');
  const attempt = async (roomId) => {
    const pv = await call(`/bookings/${b.id}/cancel-preview?bookingRoomIds=${roomId}`, { token, method: 'POST', body: { reason: 'GUEST_REQUEST', isForceMajeure: false } });
    const cx = await call(`/bookings/${b.id}/cancel`, { token, method: 'POST', body: { reason: 'GUEST_REQUEST', isForceMajeure: false, bookingRoomIds: [roomId] }, headers: { 'If-Match': pv.headers.get('etag') ?? '' } });
    return { pv, cx };
  };
  const expectOf = (roomId) => Number(floor1000(shareOf[roomId]));
  // Ca then chốt: phòng được gán ÍT cọc hơn trong sổ cái (có thể < phần theo trọng số) huỷ trước.
  const first = await attempt(small.id);
  check(`PART-2R: xem trước (?bookingRoomIds, neo ETag cho đúng tập phòng): phòng gán ít cọc nhất — refundBase theo trọng số giá phòng–đêm = ${money(shareOf[small.id])}, hoàn 100% ⇒ ${money(expectOf(small.id))} (BR-CANCEL-19)`, first.pv.status === 200 && first.pv.body.cancellation?.requestedAmount === expectOf(small.id) && first.pv.body.cancellation?.refundPercent === 100 && Boolean(first.pv.headers.get('etag')), `HTTP ${first.pv.status} ${JSON.stringify(first.pv.body)?.slice(0, 260)}`);
  let order = [small.id, big.id];
  if (first.cx.status === 200) {
    check('PART-2R: huỷ phòng gán ít cọc nhất thành công theo phần trọng số', true);
  } else {
    if (allocOf[small.id] < shareOf[small.id] && first.cx.status === 422 && errCode(first.cx) === 'E_PAY_REFUND_EXCEEDS_PAID')
      finding('F5-QA-04', 'Huỷ MỘT PHẦN booking nhiều phòng thất bại 422 E_PAY_REFUND_EXCEEDS_PAID khi phòng bị huỷ được sổ cái gán ít cọc hơn phần theo trọng số: xem trước/engine tính refundBase theo trọng số giá phòng–đêm (BR-CANCEL-19) nhưng khoản cọc được gán tuần tự vào các dòng phí, nên khách không huỷ được phòng đó dù đã thu đủ phần của nó.',
        `Booking DLX 2 phòng × 3 đêm, tổng ${b.total}, cọc đã thu ${b.paid}; gán cọc theo phòng (payment_allocations): ${JSON.stringify(Object.fromEntries(rooms.map((r) => [r.id.slice(0, 8), String(allocOf[r.id])])))} ; phần theo trọng số mỗi phòng = ${shareOf[small.id]}. Xem trước phòng ít cọc: requestedAmount=${first.pv.body?.cancellation?.requestedAmount} (200); lệnh huỷ → HTTP ${first.cx.status} ${errCode(first.cx)}; booking vẫn CONFIRMED, 0 RefundRequest.`);
    else check('PART-2R: huỷ phòng đầu tiên thành công hoặc thất bại có lý do nghiệp vụ rõ', false, `HTTP ${first.cx.status} ${errCode(first.cx)}`);
    check('PART-2R: huỷ thất bại không để lại trạng thái dở (booking CONFIRMED, 2 assignment, 0 RefundRequest, total nguyên)', (await bookingRow(b.id)).status === 'CONFIRMED' && (await activeAssignments(b.id)) === 2 && (await refundRows(b.id)).length === 0 && num((await bookingRow(b.id)).total_amount) === b.total, JSON.stringify(await bookingRow(b.id)));
    order = [big.id, small.id];
  }
  if (first.cx.status !== 200) {
    const second = await attempt(big.id);
    check(`PART-2R: huỷ phòng gán nhiều cọc hơn ⇒ 200, booking vẫn CONFIRMED, còn đúng 1 assignment, hoàn đúng phần trọng số ${money(expectOf(big.id))}`, second.cx.status === 200 && (await bookingRow(b.id)).status === 'CONFIRMED' && (await activeAssignments(b.id)) === 1 && num((await refundRows(b.id))[0]?.requested_amount) === expectOf(big.id), `HTTP ${second.cx.status} ${errCode(second.cx)} refunds=${JSON.stringify((await refundRows(b.id)).map((r) => r.requested_amount))}`);
  }
  const row = await bookingRow(b.id);
  const refunds = await refundRows(b.id);
  const cancelledNow = first.cx.status === 200 ? small.id : big.id;
  // `booking_rooms.price_per_night` là bình quân **làm tròn xuống** nên trọng số (price_per_night × nights) lệch
  // dưới `nights` VND so với Σ dòng phí ROOM. Tổng sau huỷ phải theo **dòng phí còn hiệu lực** — đúng bất biến
  // `Σ ROOM == bookings.total_amount` mà `book/cancel/writes.ts` ghi (`sum(amount - voided_amount)`), không theo trọng số.
  const remainTotal = num((await sql(`SELECT coalesce(sum(amount - voided_amount), 0)::bigint AS s FROM booking_charges WHERE booking_id = $1::uuid AND kind = 'ROOM' AND voided_amount < amount`, [b.id]))[0].s);
  const voidedRoomTotal = num((await sql(`SELECT coalesce(sum(amount - voided_amount), 0)::bigint AS s FROM booking_charges WHERE booking_room_id = $1::uuid AND kind = 'ROOM'`, [cancelledNow]))[0].s);
  check(`PART-2R: totalAmount = Σ dòng phí ROOM còn hiệu lực (${money(b.total)} → ${money(remainTotal)}); phòng huỷ bị void hết (${money(voidedRoomTotal)}), phòng còn lại giữ nguyên đơn giá`, num(row.total_amount) === remainTotal && voidedRoomTotal === 0 && num((await sql('SELECT price_per_night FROM booking_rooms WHERE id = $1::uuid', [order[1] === cancelledNow ? order[0] : order[1]]))[0].price_per_night) === num(rooms.find((r) => r.id !== cancelledNow).price_per_night), JSON.stringify({ row, remainTotal, voidedRoomTotal }));
  const after = await snapshots(b.id);
  check('PART-2R: thêm snapshot PARTIAL_CANCEL (seq tăng) và GIỮ NGUYÊN bản ORIGINAL (nội dung bất biến, BR-RATE-16)', after.length === 2 && after[1].kind === 'PARTIAL_CANCEL' && after[1].seq > after[0].seq && md5(after[0].payload_json) === originalHash, JSON.stringify(after.map((s) => [s.seq, s.kind])));
  const stale = await attempt(cancelledNow);
  check('PART-2R: huỷ lại đúng phòng đã huỷ ⇒ bị chặn, không lập hoàn thứ hai, không hoàn hai lần', stale.cx.status >= 400 && (await refundRows(b.id)).length === refunds.length, `HTTP ${stale.cx.status} ${errCode(stale.cx)}`);
  const lastRoom = rooms.find((r) => r.id !== cancelledNow).id;
  const last = await attempt(lastRoom);
  const refundsB = await refundRows(b.id);
  const sum = refundsB.reduce((a, r) => a + num(r.requested_amount), 0);
  const expectedSum = expectOf(small.id) + expectOf(big.id);
  check('PART-2R: huỷ nốt phòng còn lại ⇒ CANCELLED toàn phần, 0 assignment, tổng hoàn ≤ đã thu và bằng tổng phần trọng số (BR-PAY-07, BR-CANCEL-19)', last.cx.status === 200 && (await bookingRow(b.id)).status === 'CANCELLED' && (await activeAssignments(b.id)) === 0 && sum <= b.paid && sum === expectedSum, `HTTP ${last.cx.status} ${errCode(last.cx)} sum=${sum} paid=${b.paid} expected=${expectedSum}`);

  // ---- hai lệnh huỷ hai phòng song song (TC-BOOK-27 / TC-PAY-23): tổng giữ ≤ đã thu, mỗi phòng huỷ tối đa một lần ----
  const from2 = far();
  const c = await makeBooking('PART-RACE', { plan: 'FLEX7', type: 'DLX', from: from2, to: addDays(from2, 3), rooms: 2 });
  const cr = await sql('SELECT id FROM booking_rooms WHERE booking_id = $1::uuid ORDER BY id', [c.id]);
  const token2 = await login('frontdesk');
  const previews = await Promise.all(cr.map((r) => call(`/bookings/${c.id}/cancel-preview?bookingRoomIds=${r.id}`, { token: token2, method: 'POST', body: { reason: 'GUEST_REQUEST', isForceMajeure: false } })));
  const outs = await Promise.all(cr.map((r, i) => call(`/bookings/${c.id}/cancel`, { token: token2, method: 'POST', body: { reason: 'GUEST_REQUEST', isForceMajeure: false, bookingRoomIds: [r.id] }, headers: { 'If-Match': previews[i].headers.get('etag') ?? '' } })));
  const crefs = await refundRows(c.id);
  const csum = crefs.reduce((a, r) => a + num(r.requested_amount), 0);
  const cancelledRooms = num((await sql(`SELECT count(*)::int AS n FROM booking_rooms WHERE booking_id = $1::uuid AND status <> 'ACTIVE'`, [c.id]))[0].n);
  check('PART-RACE: hai huỷ phòng song song (phiên bản neo cũ) ⇒ không bao giờ hoàn quá đã thu, mỗi phòng huỷ nhiều nhất một lần, trạng thái khớp số phòng đã huỷ', csum <= c.paid && cancelledRooms === outs.filter((o) => o.status === 200).length && crefs.length === outs.filter((o) => o.status === 200).length, `statuses=${outs.map((o) => o.status + '/' + (errCode(o) ?? ''))} refunds=${csum}/${c.paid} cancelledRooms=${cancelledRooms}`);
}

export async function scenarioReschedule() {
  const from = far();
  const b = await makeBooking('RESCH-FLEX', { plan: 'FLEX7', type: 'STD', from, to: addDays(from, 3), pay: 'deposit' });
  const token = await login('frontdesk');
  const get = await call(`/bookings/${b.id}`, { token });
  const version = get.body?.version;
  const newFrom = addDays(from, 2);
  const newTo = addDays(newFrom, 3);
  const snapBefore = await snapshots(b.id);
  const hashBefore = md5(snapBefore[0].payload_json);
  const res = await call(`/bookings/${b.id}/reschedule`, { token, method: 'POST', body: { checkIn: newFrom, checkOut: newTo, reason: 'Khách dời lịch (QA F5)' }, headers: { 'If-Match': `"${version}"` } });
  const row = await bookingRow(b.id);
  check(`RESCH-FLEX: đổi ngày lần đầu ≥168h, gói FLEX7 ⇒ 200, phí 0, rescheduleCount = 1, vẫn CONFIRMED (BR-BOOK-12)`, res.status === 200 && num(row.reschedule_count) === 1 && row.status === 'CONFIRMED', `HTTP ${res.status} ${errCode(res)} ${JSON.stringify(res.body)?.slice(0, 200)}`);
  check('RESCH-FLEX: đổi ngày KHÔNG tạo RefundRequest (BR-CANCEL-08) và không tạo phí đổi', (await refundRows(b.id)).length === 0 && num((await sql(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1::uuid AND type = 'RESCHEDULE_FEE'`, [b.id]))[0].n) === 0, 'có RefundRequest hoặc RESCHEDULE_FEE');
  const snaps = await snapshots(b.id);
  check('RESCH-FLEX: thêm snapshot RESCHEDULE (seq tăng), giữ nguyên ORIGINAL (BR-RATE-16)', snaps.length === 2 && snaps[1].kind === 'RESCHEDULE' && md5(snaps[0].payload_json) === hashBefore, JSON.stringify(snaps.map((s) => [s.seq, s.kind])));
  const quote = await call('/quotes', { token, method: 'POST', body: { propertyId: ctx.ids.property, roomTypeId: ctx.ids.type.STD.id, channelCode: 'WALKIN', ratePlanCode: 'FLEX7', checkIn: newFrom, checkOut: newTo, adults: 2, children: 0, roomCount: 1, promotionCodes: [] } });
  const expectedTotal = Math.max(b.total, quote.body?.total ?? 0);
  check(`RESCH-FLEX: newTotal = max(oldTotal, giá kỳ mới) = ${money(expectedTotal)} (BR-BOOK-12)`, quote.status === 201 || quote.status === 200 ? num(row.total_amount) === expectedTotal : false, `HTTP ${quote.status} quote=${quote.body?.total} old=${b.total} now=${row.total_amount}`);
  const dates = await sql('SELECT check_in::text AS ci, check_out::text AS co FROM bookings WHERE id = $1::uuid', [b.id]);
  check('RESCH-FLEX: lịch & assignment chuyển sang kỳ mới trong cùng giao dịch (còn đúng 1 assignment, ngày khớp)', (await activeAssignments(b.id)) === 1 && dates[0].ci === newFrom && dates[0].co === newTo, JSON.stringify(dates));
  const second = await call(`/bookings/${b.id}/reschedule`, { token, method: 'POST', body: { checkIn: addDays(newFrom, 1), checkOut: addDays(newTo, 1) }, headers: { 'If-Match': `"${(await call(`/bookings/${b.id}`, { token })).body?.version}"` } });
  check('RESCH-FLEX: đổi ngày lần hai bị từ chối (chỉ lần đầu, BR-BOOK-12); lịch giữ nguyên', second.status >= 400 && num((await bookingRow(b.id)).reschedule_count) === 1, `HTTP ${second.status} ${errCode(second)}`);

  // NONREF: phí 10% tổng tiền phòng kỳ cũ làm tròn LÊN 1.000, ghi RESCHEDULE_FEE riêng
  const f2 = far();
  const n = await makeBooking('RESCH-NONREF', { plan: 'NONREF', type: 'SUP', from: f2, to: addDays(f2, 3), pay: 'deposit' });
  const nget = await call(`/bookings/${n.id}`, { token });
  const nres = await call(`/bookings/${n.id}/reschedule`, { token, method: 'POST', body: { checkIn: addDays(f2, 1), checkOut: addDays(f2, 4) }, headers: { 'If-Match': `"${nget.body?.version}"` } });
  const fee = Number(ceil1000((BigInt(n.total) * 10n + 99n) / 100n));
  const feeRows = await sql(`SELECT status, amount FROM payments WHERE booking_id = $1::uuid AND type = 'RESCHEDULE_FEE'`, [n.id]);
  const feeCharge = await sql(`SELECT amount FROM booking_charges WHERE booking_id = $1::uuid AND kind = 'RESCHEDULE_FEE'`, [n.id]);
  const observedFee = feeRows.length ? num(feeRows[0].amount) : feeCharge.length ? num(feeCharge[0].amount) : null;
  check(`RESCH-NONREF: NONREF đổi ngày ⇒ 200 và phí đổi = ⌈10% × ${money(n.total)}⌉ làm tròn lên 1.000 = ${money(fee)} (BR-BOOK-12)`, nres.status === 200 && observedFee === fee, `HTTP ${nres.status} ${errCode(nres)} fee kỳ vọng=${fee} quan sát=${observedFee} payments=${JSON.stringify(feeRows)} charges=${JSON.stringify(feeCharge)}`);

  // dưới ngưỡng 168h: ngưỡng đổi ngày đọc GIỜ CSDL (ADR-014, không phải đồng hồ ảo của API) nên dùng booking thật sự sắp nhận phòng.
  const f3 = addDays(D0, 3);
  const t = await makeBooking('RESCH-LATE', { plan: 'FLEX7', type: 'STD', from: f3, to: addDays(f3, 3), pay: 'deposit' });
  const tget = await call(`/bookings/${t.id}`, { token: await login('frontdesk') });
  const late = await call(`/bookings/${t.id}/reschedule`, { token: await login('frontdesk'), method: 'POST', body: { checkIn: addDays(f3, 3), checkOut: addDays(f3, 6) }, headers: { 'If-Match': `"${tget.body?.version}"` } });
  const lateRow = await bookingRow(t.id);
  check('RESCH-LATE: nhận phòng sau ~3 ngày (< 168h) ⇒ đổi ngày bị từ chối 4xx, lịch & tiền nguyên vẹn (BR-BOOK-12)', late.status >= 400 && num(lateRow.reschedule_count) === 0 && lateRow.status === 'CONFIRMED', `HTTP ${late.status} ${errCode(late)} row=${JSON.stringify(lateRow)}`);
  await realClock();
}
