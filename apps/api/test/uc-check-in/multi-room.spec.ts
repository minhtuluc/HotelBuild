/**
 * HB-206 — nhận phòng nhiều đơn vị bán và độ sẵn sàng theo lượt giải phóng.
 *
 * F7-QA-04: ghép `actualRoomIds` ↔ `booking_rooms` không được phụ thuộc thứ tự người gọi chọn.
 * F7-QA-05: bằng chứng sẵn sàng (BR-FO-07) là nhiệm vụ buồng phòng mới nhất **của lượt giải phóng gần
 * nhất**, không chỉ nhiệm vụ đúng ngày nhận phòng. Phòng chưa từng có lượt ở giữ nguyên luật cũ (chỉ
 * nhiệm vụ đúng ngày nhận phòng) — bộ khoá HB-143 vẫn xanh.
 */
import { expect, test } from 'vitest';
import {
  CHECK_IN,
  D,
  activeAssignments,
  activeRoomByUnit,
  bookingRow,
  checkInBody,
  checkInBodyMany,
  clock,
  day,
  errorCode,
  housekeeping,
  post,
  releaseStay,
  roomA,
  roomB,
  roomC,
  rows,
  seedBooking,
  staffToken,
  vn,
} from './fixture.js';

const send = async (body: object) => post(CHECK_IN, await staffToken('FRONT_DESK'), body);

const sortedAsc = (values: readonly string[]): string[] => [...values].sort();

test.each([
  ['đúng thứ tự', false],
  ['đảo thứ tự', true],
])(
  'F7-QA-04: hai đơn vị đã gán sẵn, actualRoomIds %s ⇒ 201 và giữ nguyên phòng đã gán',
  async (_name, reversed) => {
    const seed = await seedBooking({ units: 2, paidInFull: true, assignEach: [roomA(), roomB()] });
    await housekeeping(roomA());
    await housekeeping(roomB());

    const chosen = reversed ? [roomB(), roomA()] : [roomA(), roomB()];
    const response = await send(checkInBodyMany(seed, chosen));

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await activeRoomByUnit(seed)).toEqual([roomA(), roomB()]);
    expect(await bookingRow(seed.id)).toMatchObject({ status: 'CHECKED_IN' });
  },
);

test('F7-QA-04: chỉ một đơn vị đã gán ⇒ phòng đó về đúng đơn vị, phòng còn lại ghép vào đơn vị trống', async () => {
  const seed = await seedBooking({ units: 2, paidInFull: true, assignEach: [null, roomB()] });
  await housekeeping(roomA());
  await housekeeping(roomB());

  const response = await send(checkInBodyMany(seed, [roomB(), roomA()]));

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(await activeRoomByUnit(seed)).toEqual([roomA(), roomB()]);
});

test.each([
  ['A,B,C', [0, 1, 2]],
  ['C,B,A', [2, 1, 0]],
  ['B,C,A', [1, 2, 0]],
])(
  'F7-QA-04: ba đơn vị chưa gán, actualRoomIds %s ⇒ cùng một cách ghép ổn định',
  async (_name, order) => {
    const rooms = [roomA(), roomB(), roomC()];
    for (const room of rooms) await housekeeping(room);
    const seed = await seedBooking({ units: 3, paidInFull: true });

    const response = await send(
      checkInBodyMany(
        seed,
        order.map((index) => rooms[index]!),
      ),
    );

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    // Phòng id nhỏ nhất ghép vào đơn vị id nhỏ nhất (quy tắc ổn định, không phụ thuộc thứ tự gọi).
    expect(await activeRoomByUnit(seed)).toEqual(sortedAsc(rooms));
  },
);

test('F7-QA-04: phòng đã gán cho đơn vị này nhưng chọn thêm phòng khác thay phòng kia ⇒ giải phóng đúng dòng', async () => {
  const seed = await seedBooking({ units: 2, paidInFull: true, assignEach: [roomA(), roomB()] });
  await housekeeping(roomA());
  await housekeeping(roomC());

  const response = await send(checkInBodyMany(seed, [roomC(), roomA()]));

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(await activeRoomByUnit(seed)).toEqual([roomA(), roomC()]);
  const released = await rows(
    `SELECT room_id, release_reason FROM room_assignments
      WHERE booking_room_id = ANY($1::uuid[]) AND released_at IS NOT NULL`,
    [[...seed.bookingRoomIds]],
  );
  expect(released).toEqual([{ room_id: roomB(), release_reason: 'CHECKIN_ROOM_CHANGED' }]);
});

/** Lượt ở trước: trả phòng ngày D (nhả lúc 11:00 giờ VN), khách tiếp theo nhận ngày D+1. */
async function previousStayEndingOn(room: string, checkout = D): Promise<void> {
  const prior = await seedBooking({
    status: 'CHECKED_OUT',
    checkIn: day(checkout, -3),
    checkOut: checkout,
    assign: room,
  });
  await releaseStay(prior.bookingRoomId, checkout);
}

const nextDay = day(D, 1);

test('F7-QA-05: việc dọn DONE ngày trả phòng D, khách nhận ngày D+1 ⇒ nhận được', async () => {
  await previousStayEndingOn(roomA());
  await housekeeping(roomA(), D);
  clock.value = vn(nextDay, '10:00:00');
  const seed = await seedBooking({ checkIn: nextDay, paidInFull: true });

  const response = await send(checkInBody(seed, roomA()));

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(await activeAssignments(seed.bookingRoomId)).toHaveLength(1);
});

test('F7-QA-05: việc DONE thuộc lượt TRƯỚC lượt giải phóng gần nhất không chứng minh sẵn sàng ⇒ 409', async () => {
  await previousStayEndingOn(roomA());
  await housekeeping(roomA(), day(D, -3));
  clock.value = vn(nextDay, '10:00:00');
  const seed = await seedBooking({ checkIn: nextDay, paidInFull: true });

  const response = await send(checkInBody(seed, roomA()));

  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
  expect(await activeAssignments(seed.bookingRoomId)).toEqual([]);
});

test('F7-QA-05: nhiệm vụ mới nhất thắng — DONE ngày D rồi PENDING ngày D+1 (khách vừa trả lại) ⇒ 409', async () => {
  await previousStayEndingOn(roomA());
  await housekeeping(roomA(), D, 'DONE');
  await housekeeping(roomA(), nextDay, 'PENDING');
  clock.value = vn(nextDay, '10:00:00');
  const seed = await seedBooking({ checkIn: nextDay, paidInFull: true });

  const response = await send(checkInBody(seed, roomA()));

  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
});

test('F7-QA-05: nhiệm vụ của ngày SAU ngày nhận phòng không được tính', async () => {
  await previousStayEndingOn(roomA());
  await housekeeping(roomA(), day(D, 2), 'DONE');
  clock.value = vn(nextDay, '10:00:00');
  const seed = await seedBooking({ checkIn: nextDay, paidInFull: true });

  const response = await send(checkInBody(seed, roomA()));

  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
});

test('F7-QA-05: trả phòng và nhận phòng cùng ngày D vẫn dùng việc dọn đúng ngày D (hành vi cũ)', async () => {
  await previousStayEndingOn(roomA());
  await housekeeping(roomA(), D);
  const seed = await seedBooking({ checkIn: D, paidInFull: true });

  const response = await send(checkInBody(seed, roomA()));

  expect(response.status, JSON.stringify(response.body)).toBe(201);
});

test('F7-QA-05: booking chưa từng nhận phòng (CONFIRMED) không làm bẩn phòng ⇒ không nâng mốc tối thiểu', async () => {
  await seedBooking({
    status: 'CONFIRMED',
    checkIn: day(D, -3),
    checkOut: D,
    assign: roomA(),
  });
  await housekeeping(roomA(), day(D, -1));
  const seed = await seedBooking({ checkIn: D, paidInFull: true });

  // Phòng chưa từng có lượt ở thật ⇒ luật cũ: chỉ việc đúng ngày nhận phòng (D) — việc D-1 không đủ.
  const response = await send(checkInBody(seed, roomA()));

  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
});

test('AC4: phòng chưa từng có nhiệm vụ ⇒ 409 như cũ', async () => {
  await previousStayEndingOn(roomA());
  clock.value = vn(nextDay, '10:00:00');
  const seed = await seedBooking({ checkIn: nextDay, paidInFull: true });

  const response = await send(checkInBody(seed, roomA()));

  expect(response.status).toBe(409);
  expect(errorCode(response)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
});
