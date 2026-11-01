/**
 * HB-126 — test khoá **phát hiện quá tải** (giai đoạn A, đỏ có chủ đích).
 *
 * Mỗi ca đi qua use case dùng chung `createOverbookingDetection` (HB-126 giai đoạn B, HB-127 gọi lại từ
 * worker) trên PostgreSQL16 thật + clock giả. Giai đoạn A chỉ có test: khi use case chưa được hiện thực,
 * ca dừng ở thông điệp "GIAI ĐOẠN A ĐỎ CÓ CHỦ ĐÍCH" của `detection-helpers/index.ts` — không phải lỗi
 * import/thiếu môi trường. Ca cuối gọi thẳng `POST /bookings` (F4) để chứng minh D07: guard chạy trong
 * **cùng transaction** tạo booking sau khi đã khoá tồn (TC-OVER-03/04).
 *
 * Bất biến đã pin (đọc `detection-helpers/contract.ts`):
 * - gộp theo `(propertyId, date VN, roomTypeId)`, cửa sổ 30 ngày tới tính theo **ngày VN**;
 * - `T` = giờ nhận phòng danh nghĩa của cơ sở (14:00 VN), hạn xử lý là `T − 24h`;
 * - ca ngày đã qua luôn `ESCALATED`, không tự `RESOLVED` (BR-OVER-16);
 * - tự đóng chỉ khi **còn trước T−24h** và thiếu thực tế = 0, actor `SYSTEM` (`resolution_source`,
 *   `resolved_by` NULL — F6-D07).
 * Sau khi B hiện thực, không ca nào được sửa/nới; xanh hết mới đạt nghiệm thu.
 */
import { describe, expect, test } from 'vitest';
import {
  D,
  TODAY,
  assignUnits,
  auditFor,
  attemptBooking,
  block,
  cancelDemand,
  caseRow,
  caseRows,
  caseShortages,
  clock,
  createdBooking,
  day,
  dormTypeId,
  errorCode,
  escalationSignals,
  isoDay,
  findCase,
  guestSession,
  ledgerSnapshot,
  otherPropertyId,
  otherTypeId,
  outboxFor,
  propertyId,
  room2Id,
  roomId,
  rows,
  runScan,
  seedCase,
  seedShortage,
  setOverbookAllowed,
  setOverbookPct,
  typeId,
  vn,
  withFailingAuditInsert,
  withFailingCaseInsert,
} from './detection-helpers/index.js';

describe('HB-126 · phát hiện và leo thang ca quá tải', () => {
  test('TC_OVER_01_six_bookings_two_daily_cases', async () => {
    await seedShortage({ count: 3, start: D, end: day(D, 1) });
    await seedShortage({ count: 3, start: day(D, 2), end: day(D, 3) });

    const result = await runScan([propertyId]);
    expect(result.scannedAt.getTime()).toBe(clock.value);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((outcome) => outcome.action === 'CREATED')).toBe(true);
    // Sức chứa STD là 2 phòng; ba booking mỗi đêm ⇒ thiếu 1 mỗi đêm, không phải một ca/booking.
    expect(await caseShortages(propertyId)).toEqual([
      { date: D, shortage: 1 },
      { date: day(D, 2), shortage: 1 },
    ]);
    const cases = await caseRows(propertyId);
    expect(cases.map((row) => row.status)).toEqual(['OPEN', 'OPEN']);
    expect(
      cases.every((row) => row.room_type_id === typeId && isoDay(row.date) !== day(D, 1)),
    ).toBe(true);

    // Không gộp khác cơ sở: cơ sở B có ca riêng, ca của A không đổi.
    await seedShortage({
      count: 2,
      property: otherPropertyId,
      roomType: otherTypeId,
      start: D,
      end: day(D, 1),
    });
    const other = await runScan([otherPropertyId]);
    expect(other.outcomes.map((outcome) => outcome.propertyId)).toEqual([otherPropertyId]);
    expect(await caseShortages(propertyId)).toHaveLength(2);
  });

  test('HB126_window_and_inventory_units', async () => {
    // 00:30 ngày 01/12 theo giờ VN: cửa sổ bắt đầu đúng ngày VN, không phải ngày UTC 30/11.
    clock.value = vn('2026-12-01', '00:30:00');
    await seedShortage({ count: 3, start: '2026-11-30', end: '2026-12-01' });
    await seedShortage({ count: 3, start: '2027-01-15', end: '2027-01-16' });
    await seedShortage({ count: 3, start: '2026-12-02', end: '2026-12-03' });
    // 3 hold còn hạn + 1 hold hết hạn tại `now` ⇒ chỉ 3 dòng hiệu lực.
    await seedShortage({
      count: 3,
      status: 'HELD',
      holdExpiresAt: new Date(vn('2026-12-01', '02:00:00')),
      start: '2026-12-03',
      end: '2026-12-04',
    });
    await seedShortage({
      count: 1,
      status: 'HELD',
      holdExpiresAt: new Date(vn('2026-11-30', '10:00:00')),
      start: '2026-12-03',
      end: '2026-12-04',
    });
    // DOR bán theo giường: phòng 6 giường, 7 dòng nhu cầu ⇒ thiếu 1 (không phải 6).
    await seedShortage({ count: 7, roomType: dormTypeId, start: '2026-12-04', end: '2026-12-05' });
    // Hai block chồng nhau trên R1 chỉ trừ một đơn vị: còn 1 chỗ cho 2 booking ⇒ thiếu 1.
    await seedShortage({ count: 2, start: '2026-12-05', end: '2026-12-06' });
    await block(roomId, '2026-12-05', '2026-12-06');
    await block(roomId, '2026-12-05', '2026-12-06');
    // Tồn âm giữ đúng giá trị thiếu: 5 nhu cầu − 2 chỗ = 3.
    await seedShortage({ count: 5, start: '2026-12-06', end: '2026-12-07' });

    await runScan([propertyId]);
    expect(await caseShortages(propertyId)).toEqual([
      { date: '2026-12-02', shortage: 1 },
      { date: '2026-12-03', shortage: 1 },
      { date: '2026-12-04', shortage: 1 },
      { date: '2026-12-05', shortage: 1 },
      { date: '2026-12-06', shortage: 3 },
    ]);
  });

  test('HB126_concurrent_detection_deduplicates', async () => {
    await seedShortage({ count: 3, start: D, end: day(D, 1) });
    const [first, second] = await Promise.all([runScan([propertyId]), runScan([propertyId])]);
    const cases = await caseRows(propertyId);
    expect(cases).toHaveLength(1);
    const existing = cases[0]!;
    expect(existing).toMatchObject({ shortage_count: 1, status: 'OPEN' });
    expect(
      [...first.outcomes, ...second.outcomes].filter((outcome) => outcome.action === 'CREATED'),
    ).toHaveLength(1);

    const detectedAt = existing.detected_at;
    await seedShortage({ count: 2, start: D, end: day(D, 1) });
    const retry = await runScan([propertyId]);
    expect(retry.outcomes.map((outcome) => [outcome.action, outcome.shortageCount])).toEqual([
      ['UPDATED', 3],
    ]);
    expect(await caseRow(String(existing.id))).toMatchObject({
      id: existing.id,
      shortage_count: 3,
      status: 'OPEN',
      detected_at: detectedAt,
    });
  });

  test('TC_OVER_02_deadline_boundary_and_owner_escalation', async () => {
    clock.value = vn('2026-12-09', '13:59:59');
    await seedShortage({ count: 3, start: D, end: day(D, 1) });
    await runScan([propertyId]);
    const before = (await caseRows(propertyId))[0]!;
    expect(before).toMatchObject({ status: 'OPEN', escalated_at: null });
    expect(await escalationSignals(String(before.id))).toBe(0);

    // Đúng T−24h (T = 14:00 VN ngày thiếu phòng) chưa xử lý ⇒ ESCALATED + báo OWNER.
    clock.value = vn('2026-12-09', '14:00:00');
    const atDeadline = await runScan([propertyId]);
    expect(atDeadline.outcomes.map((outcome) => outcome.action)).toEqual(['ESCALATED']);
    const escalated = (await caseRows(propertyId))[0]!;
    expect(escalated).toMatchObject({ status: 'ESCALATED', escalated_at: new Date(clock.value) });
    const caseId = String(escalated.id);
    // Ca đã mở trước đó nên outbox có cả `opened`; chỉ đếm sự kiện leo thang.
    const escalations = async () =>
      (await outboxFor(caseId)).filter(
        (event) => event.event_type === 'overbooking.case.escalated',
      );
    const events = await escalations();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'overbooking.case.escalated',
      aggregate_type: 'OverbookingCase',
    });
    expect(events[0]!.payload_json).toMatchObject({
      caseId,
      toStatus: 'ESCALATED',
      notifyRole: 'OWNER',
    });

    // Quét lại không tạo thêm sự kiện chuyển trạng thái.
    expect((await runScan([propertyId])).outcomes.map((outcome) => outcome.action)).toEqual([
      'UNCHANGED',
    ]);
    expect(await escalations()).toHaveLength(1);
  });

  test('HB126_late_discovery_escalates_without_retroactive_detection', async () => {
    clock.value = vn('2026-12-10', '09:00:00');
    await seedShortage({ count: 3, start: D, end: day(D, 1) });
    expect((await runScan([propertyId])).outcomes.map((outcome) => outcome.action)).toEqual([
      'CREATED',
    ]);

    const discovered = (await caseRows(propertyId))[0]!;
    expect(discovered).toMatchObject({
      status: 'ESCALATED',
      detected_at: new Date(clock.value),
      escalated_at: new Date(clock.value),
    });
    // Không gán phát hiện hồi tố: mọi dấu audit của ca không sớm hơn lúc biết.
    const audits = await auditFor(String(discovered.id));
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits)
      expect(new Date(String(audit.at)).getTime()).toBeGreaterThanOrEqual(clock.value);
  });

  test('TC_OVER_17_past_case_never_auto_closes', async () => {
    const demand = await seedShortage({ count: 3, start: D, end: day(D, 1) });
    const detectedAt = new Date(vn('2026-12-01', '09:00:00'));
    const caseId = await seedCase({
      propertyId,
      date: D,
      roomTypeId: typeId,
      shortageCount: 1,
      detectedAt,
      delayReason: 'MAINTENANCE',
    });

    clock.value = vn('2026-12-11', '09:00:00');
    await runScan([propertyId]);
    expect(await caseRow(caseId)).toMatchObject({
      status: 'ESCALATED',
      escalated_at: new Date(clock.value),
      detected_at: detectedAt,
      resolved_at: null,
      resolved_by: null,
      delay_reason: 'MAINTENANCE',
    });

    // Thiếu về 0 vẫn không đóng ca đã quá ngày.
    await cancelDemand(demand.map((row) => row.bookingId));
    clock.value = vn('2026-12-20', '09:00:00');
    await runScan([propertyId]);
    expect(await caseRow(caseId)).toMatchObject({ status: 'ESCALATED', resolved_at: null });

    // Ra khỏi cửa sổ 30 ngày: ca vẫn được giữ để UC-REP-04 đối soát.
    clock.value = vn('2027-02-01', '09:00:00');
    await runScan([propertyId]);
    expect(await caseRows(propertyId)).toHaveLength(1);
    expect(await caseRow(caseId)).toMatchObject({
      status: 'ESCALATED',
      delay_reason: 'MAINTENANCE',
    });
  });

  test('HB126_detection_atomic_without_resolution_side_effects', async () => {
    clock.value = vn('2026-12-08', '09:00:00');
    await seedShortage({ count: 3, start: D, end: day(D, 1) });
    const ledger = await ledgerSnapshot();
    await runScan([propertyId]);
    // Quét không đụng tiền/assignment.
    expect(await ledgerSnapshot()).toBe(ledger);

    const created = (await caseRows(propertyId))[0]!;
    const caseId = String(created.id);
    const openedAudit = await auditFor(caseId);
    expect(openedAudit).toHaveLength(1);
    expect(openedAudit[0]).toMatchObject({ action: 'CREATE', actor_role: 'SYSTEM' });
    expect(await outboxFor(caseId)).toHaveLength(1);

    // Lượt sau: thiếu tăng 1→2 nhưng audit lỗi ⇒ ca + audit + outbox phải rollback cùng nhau.
    await seedShortage({ count: 1, start: D, end: day(D, 1) });
    await withFailingAuditInsert(async () => {
      await expect(runScan([propertyId])).rejects.toThrow();
    });
    expect(await caseRow(caseId)).toMatchObject({ shortage_count: 1, status: 'OPEN' });
    expect(await auditFor(caseId)).toHaveLength(1);
    expect(await outboxFor(caseId)).toHaveLength(1);

    // Retry không mất cảnh báo: thiếu cập nhật và audit mới xuất hiện.
    await runScan([propertyId]);
    expect(await caseRow(caseId)).toMatchObject({ shortage_count: 2 });
    expect((await auditFor(caseId)).length).toBe(2);
    expect(await ledgerSnapshot()).toBe(ledger);

    // Ca mới cũng nguyên tử: ghi ca lỗi ⇒ không có ca/audit mồ côi cho đêm sau.
    await seedShortage({ count: 3, start: day(D, 1), end: day(D, 2) });
    await withFailingCaseInsert(async () => {
      await expect(runScan([propertyId])).rejects.toThrow();
    });
    expect(await findCase(propertyId, day(D, 1), typeId)).toBeUndefined();
  });

  test('HB126_f6_d07_auto_close_requires_system_actor_before_deadline', async () => {
    clock.value = vn('2026-12-08', '09:00:00');
    const first = await seedShortage({ count: 3, start: D, end: day(D, 1) });
    await runScan([propertyId]);
    const caseId = String((await caseRows(propertyId))[0]!.id);

    // Còn trước T−24h và thiếu thực tế = 0 ⇒ tự đóng bằng actor hệ thống, không user giả.
    await cancelDemand(first.map((row) => row.bookingId));
    const closed = await runScan([propertyId]);
    expect(closed.outcomes.map((outcome) => outcome.action)).toEqual(['AUTO_RESOLVED']);
    expect(await caseRow(caseId)).toMatchObject({
      status: 'RESOLVED',
      resolution_source: 'SYSTEM',
      resolved_by: null,
      resolved_at: new Date(clock.value),
      shortage_count: 1,
    });

    // Từ T−24h trở đi ca do người xử lý, kể cả khi thiếu đã về 0.
    const night = day(D, 2);
    const second = await seedShortage({ count: 3, start: night, end: day(night, 1) });
    await runScan([propertyId]);
    clock.value = vn('2026-12-11', '14:00:00');
    await runScan([propertyId]);
    const later = await findCase(propertyId, night, typeId);
    expect(later).toMatchObject({ status: 'ESCALATED' });

    await cancelDemand(second.map((row) => row.bookingId));
    await runScan([propertyId]);
    expect(await caseRow(String(later!.id))).toMatchObject({
      status: 'ESCALATED',
      resolved_at: null,
      resolution_source: null,
    });
  });

  test('HB126_f4_booking_transaction_invokes_guard', async () => {
    clock.value = vn(TODAY, '09:00:00');
    await setOverbookPct(5);
    await setOverbookAllowed('WEB', true);
    const sold = await seedShortage({ count: 2, start: D, end: day(D, 1) });
    await assignUnits(sold[0]!.bookingRoomId, roomId, D, day(D, 1));
    await assignUnits(sold[1]!.bookingRoomId, room2Id, D, day(D, 1));

    // TC-OVER-03: hết phòng vật lý nhưng còn trần bán vượt ⇒ nhận booking + mở ca ngay trong TX.
    const oversold = createdBooking(
      await attemptBooking(await guestSession(), { checkIn: D, checkOut: day(D, 1) }),
    );
    expect(oversold).toMatchObject({ oversold: true, status: 'HELD' });
    expect(await findCase(propertyId, D, typeId)).toMatchObject({
      status: 'OPEN',
      shortage_count: 1,
    });

    // TC-OVER-04: hết trần (2 phòng ⇒ trần 1) ⇒ 409, không booking, không thêm ca.
    const refused = await attemptBooking(await guestSession(), { checkIn: D, checkOut: day(D, 1) });
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('E_OVER_LIMIT_EXCEEDED');
    expect(await caseRows(propertyId)).toHaveLength(1);
    expect(await bookingsOn(D)).toBe(3);

    // Ghi ca lỗi ⇒ rollback cả booking: guard nằm trong cùng transaction F4 sau khi khoá tồn.
    const night = day(D, 2);
    const free = await seedShortage({ count: 2, start: night, end: day(night, 1) });
    await assignUnits(free[0]!.bookingRoomId, roomId, night, day(night, 1));
    await assignUnits(free[1]!.bookingRoomId, room2Id, night, day(night, 1));
    await withFailingCaseInsert(async () => {
      expect(
        (await attemptBooking(await guestSession(), { checkIn: night, checkOut: day(night, 1) }))
          .status,
      ).toBe(500);
    });
    expect(await findCase(propertyId, night, typeId)).toBeUndefined();
    expect(await bookingsOn(night)).toBe(2);
  });
});

async function bookingsOn(night: string): Promise<number> {
  const found = await rows('SELECT count(*)::int AS total FROM bookings WHERE check_in=$1', [
    night,
  ]);
  return Number(found[0]!.total);
}
