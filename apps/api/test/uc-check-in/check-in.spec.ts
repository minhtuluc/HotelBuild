/**
 * HB-144 — test riêng của lát cắt nhận phòng (bổ sung cho bộ khoá HB-143):
 * - gán phòng thật idempotent (đã có assignment đúng phòng / đổi phòng thực tế);
 * - ngưỡng nợ của MANAGER theo **cả hai** điều kiện `deal.threshold.checkInDebt` + `checkInDebtPct`
 *   (chỉ vượt số tiền, chỉ vượt phần trăm, vượt cả hai) và quyền OWNER khi vượt;
 * - mốc 23:59 ngày nhận phòng (BR-FO-02) tính theo giây;
 * - che PII số giấy tờ trong nhật ký (NFR-SEC-03).
 */
import { expect, test } from 'vitest';
import { checkInResponseSchema } from '@pinehill/contracts';
import type { SeededBooking } from './fixture.js';
import {
  CHECK_IN,
  D,
  activeAssignments,
  allAssignments,
  auditPayloads,
  bookingRow,
  checkInBody,
  clock,
  day,
  errorCode,
  guestIdNumber,
  guestOf,
  historyRows,
  housekeeping,
  post,
  roomA,
  roomB,
  seedBooking,
  staffToken,
  vn,
} from './fixture.js';

const checkIn = async (
  seed: SeededBooking,
  room: string,
  role = 'FRONT_DESK',
  extra: object = {},
) => post(CHECK_IN, await staffToken(role), checkInBody(seed, room, extra));

test('assignment đã đúng phòng thì không tạo dòng thứ hai (idempotent)', async () => {
  const seed = await seedBooking({ paidInFull: true, assign: roomA() });
  await housekeeping(roomA());

  const response = await checkIn(seed, roomA());

  expect(response.status).toBe(201);
  expect(checkInResponseSchema.parse(response.body)).toMatchObject({
    status: 'CHECKED_IN',
    roomIds: [roomA()],
    earlyCheckInFee: 0,
  });
  expect(await allAssignments(seed.bookingRoomId)).toHaveLength(1);
  expect(await activeAssignments(seed.bookingRoomId)).toEqual([
    { room_id: roomA(), bed_no: 0, start_date: D, end_date: day(D, 2) },
  ]);
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
  expect(await historyRows(seed.id, 'CHECKED_IN')).toHaveLength(1);
});

test('đổi phòng thực tế: giải phóng dòng cũ rồi gán dòng mới trong cùng transaction', async () => {
  const seed = await seedBooking({ paidInFull: true, assign: roomA() });
  await housekeeping(roomB());

  const response = await checkIn(seed, roomB());

  expect(response.status).toBe(201);
  const assignments = await allAssignments(seed.bookingRoomId);
  expect(assignments).toHaveLength(2);
  expect(assignments[0]).toMatchObject({
    room_id: roomA(),
    release_reason: 'CHECKIN_ROOM_CHANGED',
  });
  expect(assignments[0]!.released_at).not.toBeNull();
  expect(assignments[1]).toMatchObject({ room_id: roomB(), released_at: null });
  expect(await activeAssignments(seed.bookingRoomId)).toEqual([
    { room_id: roomB(), bed_no: 0, start_date: D, end_date: day(D, 2) },
  ]);
});

test('ngưỡng nợ: chỉ vượt số tiền → MANAGER từ chối, OWNER duyệt', async () => {
  // 10 đêm × 2.000.000 = 20.000.000; đã thu 14.999.999 ⇒ nợ 5.000.001 (25,000005%): chỉ vượt số tiền.
  const seed = await seedBooking({
    nightly: 2_000_000,
    checkOut: day(D, 10),
    paid: 14_999_999,
  });
  await housekeeping(roomA());

  const manager = await checkIn(seed, roomA(), 'MANAGER');
  expect(manager.status).toBe(409);
  expect(errorCode(manager)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
  expect(await activeAssignments(seed.bookingRoomId)).toEqual([]);

  const owner = await checkIn(seed, roomA(), 'OWNER');
  expect(owner.status).toBe(201);
  expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
});

test('ngưỡng nợ: đúng 5.000.000 là đủ (biên bao gồm) → MANAGER duyệt + audit số tiền/hạn thu', async () => {
  // 10 đêm × 2.000.000 = 20.000.000; đã thu 15.000.000 ⇒ nợ 5.000.000 (25%) — đúng cả hai ngưỡng.
  const seed = await seedBooking({
    nightly: 2_000_000,
    checkOut: day(D, 10),
    paid: 15_000_000,
  });
  await housekeeping(roomA());

  const response = await checkIn(seed, roomA(), 'MANAGER', { note: 'Cho nợ tới khi trả phòng' });

  expect(response.status).toBe(201);
  const audits = await auditPayloads(seed.id);
  expect(
    audits.some(
      (row) =>
        row.action === 'CHECKIN_DEBT_APPROVED' &&
        String(row.reason).length > 0 &&
        String(row.payload).includes('5000000') &&
        String(row.payload).includes(day(D, 10)),
    ),
    'Thiếu nhật ký duyệt nợ kèm số tiền và hạn thu (BR-FO-01)',
  ).toBe(true);
});

test('ngưỡng nợ: chỉ vượt 50% → MANAGER từ chối, OWNER duyệt', async () => {
  // 8 đêm × 1.000.000 = 8.000.000; đã thu 3.500.000 ⇒ nợ 4.500.000 (56,25%).
  const seed = await seedBooking({ nightly: 1_000_000, checkOut: day(D, 8), paid: 3_500_000 });
  await housekeeping(roomA());

  const manager = await checkIn(seed, roomA(), 'MANAGER');
  expect(manager.status).toBe(409);
  expect(errorCode(manager)).toBe('E_FO_CHECKIN_NOT_ALLOWED');

  const owner = await checkIn(seed, roomA(), 'OWNER');
  expect(owner.status).toBe(201);
});

test('ngưỡng nợ: đúng 50% là đủ (biên bao gồm) → MANAGER duyệt', async () => {
  // 8 đêm × 1.000.000 = 8.000.000; đã thu 4.000.000 ⇒ nợ 4.000.000 = 50%.
  const seed = await seedBooking({ nightly: 1_000_000, checkOut: day(D, 8), paid: 4_000_000 });
  await housekeeping(roomA());

  const response = await checkIn(seed, roomA(), 'MANAGER');

  expect(response.status).toBe(201);
});

test('ngưỡng nợ: vượt cả hai → MANAGER từ chối, OWNER duyệt', async () => {
  // 8 đêm × 1.000.000 = 8.000.000; đã thu 2.000.000 ⇒ nợ 6.000.000 (75%) vượt cả hai ngưỡng.
  const seed = await seedBooking({ nightly: 1_000_000, checkOut: day(D, 8), paid: 2_000_000 });
  await housekeeping(roomA());

  const manager = await checkIn(seed, roomA(), 'MANAGER');
  expect(manager.status).toBe(409);
  expect(errorCode(manager)).toBe('E_FO_CHECKIN_NOT_ALLOWED');

  const owner = await checkIn(seed, roomA(), 'OWNER');
  expect(owner.status).toBe(201);
});

test('23:58:59 còn nhận phòng được; đúng 23:59:00 và sang ngày hôm sau thì chặn', async () => {
  const early = await seedBooking({ paidInFull: true });
  await housekeeping(roomA());
  clock.value = vn(D, '23:58:59');
  expect((await checkIn(early, roomA())).status).toBe(201);

  const boundary = await seedBooking({ paidInFull: true });
  await housekeeping(roomB());
  clock.value = vn(D, '23:59:00');
  const blocked = await checkIn(boundary, roomB());
  expect(blocked.status).toBe(409);
  expect(errorCode(blocked)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
  expect(await bookingRow(boundary.id)).toMatchObject({ status: 'CONFIRMED' });
  expect(await activeAssignments(boundary.bookingRoomId)).toEqual([]);

  const nextDay = await seedBooking({ paidInFull: true });
  clock.value = vn(day(D, 1), '00:00:01');
  const late = await checkIn(nextDay, roomA());
  expect(late.status).toBe(409);
  expect(errorCode(late)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
});

test('số giấy tờ: lưu đúng cột guests.id_number nhưng chỉ vào nhật ký ở dạng che', async () => {
  const seed = await seedBooking({ paidInFull: true });
  await housekeeping(roomA());
  const idNumber = '079201001234';

  const response = await checkIn(seed, roomA(), 'FRONT_DESK', { idNumber });

  expect(response.status).toBe(201);
  expect(await guestIdNumber(guestOf())).toBe(idNumber);
  const audits = await auditPayloads(seed.id);
  expect(audits.some((row) => String(row.payload).includes('****1234'))).toBe(true);
  expect(audits.some((row) => String(row.payload).includes(idNumber))).toBe(false);
  expect(JSON.stringify(response.body)).not.toContain(idNumber);
});

test('phòng chưa có nhiệm vụ của ngày nhận phòng vẫn bị chặn dù task hôm trước DONE', async () => {
  const seed = await seedBooking({ paidInFull: true });
  await housekeeping(roomA(), day(D, -1));

  const response = await checkIn(seed, roomA());

  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
  expect(await activeAssignments(seed.bookingRoomId)).toEqual([]);
});

test('phòng của booking khác đang ở (assignment chưa giải phóng) → chặn, không gán chồng', async () => {
  await seedBooking({ status: 'CHECKED_IN', checkIn: day(D, -1), assign: roomA() });
  await housekeeping(roomA());
  const seed = await seedBooking({ paidInFull: true });

  const response = await checkIn(seed, roomA());

  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
  expect(await activeAssignments(seed.bookingRoomId)).toEqual([]);
});
