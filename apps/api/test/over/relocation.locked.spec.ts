/**
 * HB-124 giai đoạn A — khoá use case điều chuyển phòng trên PostgreSQL16 + Redis7 thật.
 *
 * Các tuyến dưới đây **chưa tồn tại** (HB-125 hiện thực): `POST /room-moves`,
 * `/{id}/approve|execute`, `POST /overbooking-cases/{id}/relocation-plan|resolve`,
 * `GET /room-moves/{id}`, `GET /bookings/{id}/relocation-options`. Đỏ vì thiếu hành vi là chủ đích
 * của F6-D05; không `skip`/`todo`, không nới assertion.
 */
import { expect, test } from 'vitest';
import {
  D,
  day,
  etagOf,
  errorCode,
  get,
  guardRoute,
  mintPin,
  post,
  rows,
  staffToken,
  userIds,
} from './helpers/harness.js';
import { MOVES, executeMove, moveBody, proposeMove } from './helpers/actions.js';
import {
  activeAssignments,
  assignmentsOnRoom,
  bookingRow,
  countRows,
  guests,
  moveRow,
  otherPropertyId,
  roomTypes,
  rooms,
  seedBooking,
  seedCase,
} from './helpers/seed.js';
import { moveViewSchema } from './helpers/views.js';

const deskPin = (bookingId: string) => mintPin('desk', bookingId);

test('HB124_create_is_proposal_execute_rechecks_versions', async () => {
  const seeded = await seedBooking({ assignRoomIds: [rooms.r1] });
  const caseId = await seedCase({ shortage: 1 });
  const token = await staffToken('desk');
  const plan = await post(`/api/v1/overbooking-cases/${caseId}/relocation-plan`, token, {
    strategy: 'AUTO',
  });
  guardRoute(plan, 'POST /overbooking-cases/{id}/relocation-plan');
  expect([200, 201]).toContain(plan.status);
  expect(await activeAssignments(seeded.bookingRoomIds[0]!)).toHaveLength(1);

  const proposal = await proposeMove(
    token,
    moveBody(seeded.id, seeded.bookingRoomIds[0]!, rooms.r2, { overbookingCaseId: caseId }),
  );
  expect(proposal.status).toBe('PROPOSED');
  expect(proposal.priceLocked).toBe(true);
  expect(await activeAssignments(seeded.bookingRoomIds[0]!)).toMatchObject([
    { room_id: rooms.r1, released_at: null },
  ]);
  expect(await assignmentsOnRoom(rooms.r2)).toHaveLength(0);

  expect((await executeMove(proposal.id, token, await deskPin(seeded.id))).status).toBe(428);
  expect((await executeMove(proposal.id, token, await deskPin(seeded.id), '"0"')).status).toBe(412);

  const read = await get(`${MOVES}/${proposal.id}`, token);
  expect(read.status).toBe(200);
  const tag = etagOf(read);
  // Version booking liên quan đổi sau khi client đọc ⇒ execute phải đọc lại trong TX.
  await rows('UPDATE bookings SET note=$2 WHERE id=$1', [seeded.id, 'changed after read']);
  expect((await executeMove(proposal.id, token, await deskPin(seeded.id), tag)).status).toBe(412);
  expect(await activeAssignments(seeded.bookingRoomIds[0]!)).toHaveLength(1);

  const fresh = etagOf(await get(`${MOVES}/${proposal.id}`, token));
  const done = await executeMove(proposal.id, token, await deskPin(seeded.id), fresh);
  expect([200, 201]).toContain(done.status);
  expect(await activeAssignments(seeded.bookingRoomIds[0]!)).toEqual([]);
  expect(await assignmentsOnRoom(rooms.r2)).toMatchObject([
    { booking_room_id: seeded.bookingRoomIds[0], bed_no: 0 },
  ]);
  expect((await moveRow(proposal.id)).status).toBe('EXECUTED');
});

test('TC_OVER_18_target_taken_preserves_source', async () => {
  const seeded = await seedBooking({ assignRoomIds: [rooms.r1] });
  const token = await staffToken('desk');
  const proposal = await proposeMove(
    token,
    moveBody(seeded.id, seeded.bookingRoomIds[0]!, rooms.r2),
  );
  const rival = await seedBooking({ assignRoomIds: [rooms.r2] });
  const tag = etagOf(await get(`${MOVES}/${proposal.id}`, token));
  const executed = await executeMove(proposal.id, token, await deskPin(seeded.id), tag);
  expect(executed.status).toBe(409);
  expect(['E_INV_ROOM_TAKEN', 'E_OVER_TARGET_NOT_AVAILABLE']).toContain(errorCode(executed));
  expect(await activeAssignments(seeded.bookingRoomIds[0]!)).toMatchObject([
    { room_id: rooms.r1, released_at: null },
  ]);
  expect(await assignmentsOnRoom(rooms.r2)).toMatchObject([
    { booking_room_id: rival.bookingRoomIds[0] },
  ]);
  expect((await bookingRow(seeded.id)).status).toBe('CONFIRMED');
  expect(await countRows("SELECT id FROM overbooking_cases WHERE status='RESOLVED'")).toBe(0);
});

test('HB124_concurrent_execute_one_winner', async () => {
  const first = await seedBooking({ assignRoomIds: [rooms.r1] });
  const second = await seedBooking({ assignRoomIds: [rooms.r3] });
  const token = await staffToken('desk');
  const moveA = await proposeMove(token, moveBody(first.id, first.bookingRoomIds[0]!, rooms.r2));
  const moveB = await proposeMove(token, moveBody(second.id, second.bookingRoomIds[0]!, rooms.r2));
  const [readA, readB] = await Promise.all([
    get(`${MOVES}/${moveA.id}`, token),
    get(`${MOVES}/${moveB.id}`, token),
  ]);
  const tagA = etagOf(readA);
  const tagB = etagOf(readB);
  const [pinA, pinB] = await Promise.all([deskPin(first.id), deskPin(second.id)]);
  const [resultA, resultB] = await Promise.all([
    executeMove(moveA.id, token, pinA, tagA),
    executeMove(moveB.id, token, pinB, tagB),
  ]);
  const winners = [resultA.status, resultB.status].filter(
    (status) => status === 200 || status === 201,
  );
  expect(winners).toHaveLength(1);
  const roomAssignments = await assignmentsOnRoom(rooms.r2);
  expect(roomAssignments).toHaveLength(1);
  const winning = String(roomAssignments[0]!.booking_room_id);
  const losing = winning === first.bookingRoomIds[0] ? second : first;
  expect(await activeAssignments(losing.bookingRoomIds[0]!)).toHaveLength(1);
  expect(await countRows("SELECT id FROM room_moves WHERE status='EXECUTED'")).toBe(1);
});

test('HB124_source_target_scopes_and_replay_auth', async () => {
  const seeded = await seedBooking({ assignRoomIds: [rooms.r1] });
  const limited = await staffToken('scoped');
  const cross = await post(
    MOVES,
    limited,
    moveBody(seeded.id, seeded.bookingRoomIds[0]!, rooms.x1, {
      moveType: 'SAME_TYPE_CROSS_PROPERTY',
      compensationAmount: 100_000,
      transportCost: 50_000,
      forceMajeure: true,
    }),
  );
  guardRoute(cross, 'POST /room-moves');
  expect(cross.status).toBe(403);
  expect(errorCode(cross)).toBe('E_AUTH_OUT_OF_SCOPE');

  // Có scope nguồn + scope đích thì lập được phương án (không tự thực thi).
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
    userIds.scoped,
    otherPropertyId,
  ]);
  const allowed = await post(
    MOVES,
    limited,
    moveBody(seeded.id, seeded.bookingRoomIds[0]!, rooms.x1, {
      moveType: 'SAME_TYPE_CROSS_PROPERTY',
    }),
  );
  expect(allowed.status).toBe(201);
  const proposal = moveViewSchema.parse(allowed.body);
  await rows(
    'INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid) ON CONFLICT DO NOTHING',
    [userIds.manager, otherPropertyId],
  );
  for (const key of ['desk', 'accountant', 'sysadmin'] as const) {
    const approved = await post(`${MOVES}/${proposal.id}/approve`, await staffToken(key), {
      compensationAmount: 0,
      transportCost: 0,
      note: `Thử quyền ${key}`,
      pinToken: await mintPin(key, seeded.id),
    });
    expect(approved.status).toBe(403);
  }

  const manager = await staffToken('manager');
  const key = 'hb124-replay-auth';
  const body = {
    compensationAmount: 0,
    transportCost: 0,
    note: 'Duyệt lần đầu',
    pinToken: await mintPin('manager', seeded.id),
  };
  expect([200, 201]).toContain(
    (await post(`${MOVES}/${proposal.id}/approve`, manager, body, { key })).status,
  );
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userIds.manager]);
  expect((await post(`${MOVES}/${proposal.id}/approve`, manager, body, { key })).status).toBe(403);
});

test('HB124_approve_execute_pin_enforced', async () => {
  const seeded = await seedBooking({ assignRoomIds: [rooms.r1] });
  const token = await staffToken('desk');
  const proposal = await proposeMove(
    token,
    moveBody(seeded.id, seeded.bookingRoomIds[0]!, rooms.r2, {
      compensationAmount: 1_000_000,
      transportCost: 200_000,
    }),
  );
  const manager = await staffToken('manager');
  const body = {
    compensationAmount: 1_000_000,
    transportCost: 200_000,
    note: 'Bồi thường theo BR-OVER-06',
  };
  const missing = await post(`${MOVES}/${proposal.id}/approve`, manager, body);
  expect(missing.status).toBe(401);
  expect(errorCode(missing)).toBe('E_AUTH_PIN_REQUIRED');
  expect(
    (await post(`${MOVES}/${proposal.id}/approve`, manager, { ...body, pinToken: 'x'.repeat(24) }))
      .status,
  ).toBe(401);
  const approved = await post(`${MOVES}/${proposal.id}/approve`, manager, {
    ...body,
    pinToken: await mintPin('manager', seeded.id),
  });
  expect(approved.status).toBe(200);
  expect(moveViewSchema.parse(approved.body).status).toBe('APPROVED');

  const tag = etagOf(await get(`${MOVES}/${proposal.id}`, token));
  expect((await post(`${MOVES}/${proposal.id}/execute`, token, {}, { tag })).status).toBe(401);
  const pin = await deskPin(seeded.id);
  expect([200, 201]).toContain((await executeMove(proposal.id, token, pin, tag)).status);
  const reused = await executeMove(proposal.id, token, pin);
  expect([401, 409]).toContain(reused.status);
  expect(
    JSON.stringify(await rows('SELECT after_json::text AS after FROM audit_logs')).includes(
      '123456',
    ),
  ).toBe(false);
});

test('TC_OVER_09_force_majeure_approval_and_free_move', async () => {
  const token = await staffToken('desk');
  const inHouse = await seedBooking({
    status: 'CHECKED_IN',
    checkIn: day(D, -1),
    nightlyPrices: [500_000, 500_000],
    assignRoomIds: [rooms.r1],
  });
  const refused = await post(
    MOVES,
    token,
    moveBody(inHouse.id, inHouse.bookingRoomIds[0]!, rooms.r2),
  );
  guardRoute(refused, 'POST /room-moves');
  expect(refused.status).toBe(409);
  expect(errorCode(refused)).toBe('E_OVER_MOVE_NOT_ALLOWED');

  const force = await post(
    MOVES,
    token,
    moveBody(inHouse.id, inHouse.bookingRoomIds[0]!, rooms.r2, { forceMajeure: true }),
  );
  expect(force.status).toBe(201);
  const forced = moveViewSchema.parse(force.body);
  const tag = etagOf(await get(`${MOVES}/${forced.id}`, token));
  const unsigned = await executeMove(forced.id, token, await deskPin(inHouse.id), tag);
  expect([403, 409]).toContain(unsigned.status);
  expect(errorCode(unsigned)).toBe('E_OVER_APPROVAL_REQUIRED');

  const approved = await post(`${MOVES}/${forced.id}/approve`, await staffToken('manager'), {
    compensationAmount: 0,
    transportCost: 0,
    note: 'Hỏng điều hoà, bất khả kháng',
    pinToken: await mintPin('manager', inHouse.id),
  });
  expect([200, 201]).toContain(approved.status);
  const fresh = etagOf(await get(`${MOVES}/${forced.id}`, token));
  expect([200, 201]).toContain(
    (await executeMove(forced.id, token, await deskPin(inHouse.id), fresh)).status,
  );

  // Cùng cơ sở, zero-cost, chưa check-in: BR-OVER-06/09 không bắt duyệt MANAGER.
  const free = await seedBooking({ assignRoomIds: [rooms.r3] });
  const freeMove = await proposeMove(token, moveBody(free.id, free.bookingRoomIds[0]!, rooms.r2));
  const freeTag = etagOf(await get(`${MOVES}/${freeMove.id}`, token));
  expect([200, 201]).toContain(
    (await executeMove(freeMove.id, token, await deskPin(free.id), freeTag)).status,
  );
});

test('TC_OVER_08_SPLIT_ROOMS_price_units_no_child_booking', async () => {
  const prices = [700_000, 800_000, 900_000];
  const seeded = await seedBooking({
    nightlyPrices: prices,
    spaces: 2,
    assignRoomIds: [rooms.r1, rooms.r2],
  });
  const token = await staffToken('desk');
  const proposal = await proposeMove(
    token,
    moveBody(seeded.id, seeded.bookingRoomIds[1]!, rooms.r3, { moveType: 'SPLIT_ROOMS' }),
  );
  expect(proposal.priceLocked).toBe(true);
  const tag = etagOf(await get(`${MOVES}/${proposal.id}`, token));
  expect([200, 201]).toContain(
    (await executeMove(proposal.id, token, await deskPin(seeded.id), tag)).status,
  );

  const snapshots = await rows(
    'SELECT kind,gross_amount::text AS gross FROM price_snapshots WHERE booking_id=$1',
    [seeded.id],
  );
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]!.gross).toBe(String(prices.reduce((sum, price) => sum + price, 0) * 2));
  expect(await countRows('SELECT id FROM bookings')).toBe(1);
  expect(await countRows('SELECT id FROM refund_requests')).toBe(0);
  const charges = await rows(
    "SELECT amount::text AS amount,voided_amount::text AS voided FROM booking_charges WHERE booking_id=$1 AND kind='ROOM' ORDER BY source_key",
    [seeded.id],
  );
  expect(charges.map((line) => `${line.amount}/${line.voided}`)).toEqual(
    [...prices, ...prices].map((price) => `${price}/0`),
  );
  expect(await activeAssignments(seeded.bookingRoomIds[1]!)).toMatchObject([
    { room_id: rooms.r3, released_at: null },
  ]);
});

test('HB124_resolve_requires_actual_shortage_zero', async () => {
  const manager = await staffToken('manager');
  for (const guest of [guests.male, guests.female])
    await seedBooking({ roomType: roomTypes.oversold, guest });
  const caseId = await seedCase({ shortage: 1, roomType: roomTypes.oversold });
  const blocked = await post(`/api/v1/overbooking-cases/${caseId}/resolve`, manager, {
    resolutionNote: 'Đã xử lý xong',
  });
  guardRoute(blocked, 'POST /overbooking-cases/{id}/resolve');
  expect(blocked.status).toBe(409);
  expect(
    String((await rows('SELECT status FROM overbooking_cases WHERE id=$1', [caseId]))[0]!.status),
  ).not.toBe('RESOLVED');

  await rows(
    "UPDATE bookings SET status='CANCELLED',cancelled_at=clock_timestamp(),cancel_reason='GUEST_REQUEST' WHERE status='CONFIRMED' AND room_type_id=$1::uuid",
    [roomTypes.oversold],
  );
  expect([200, 201]).toContain(
    (
      await post(`/api/v1/overbooking-cases/${caseId}/resolve`, manager, {
        resolutionNote: 'Khách huỷ, thiếu phòng thực tế = 0',
      })
    ).status,
  );
  expect(
    await rows('SELECT status,resolved_by FROM overbooking_cases WHERE id=$1', [caseId]),
  ).toMatchObject([{ status: 'RESOLVED', resolved_by: userIds.manager }]);

  const past = await seedCase({
    date: day(D, -30),
    status: 'ESCALATED',
    shortage: 1,
    roomType: roomTypes.oversold,
    delayReason: 'Ca tồn từ hôm trước',
  });
  expect([200, 201]).toContain(
    (
      await post(`/api/v1/overbooking-cases/${past}/resolve`, manager, {
        resolutionNote: 'Sự cố tại chỗ đã xử lý',
      })
    ).status,
  );
  const kept = (
    await rows(
      'SELECT status,detected_at,escalated_at,delay_reason FROM overbooking_cases WHERE id=$1',
      [past],
    )
  )[0]!;
  expect(kept.status).toBe('RESOLVED');
  expect(kept.detected_at).not.toBeNull();
  expect(kept.escalated_at).not.toBeNull();
  expect(kept.delay_reason).toBe('Ca tồn từ hôm trước');
});

test('HB124_staff_projection_and_handoff_reads', async () => {
  const inScope = await seedBooking({ assignRoomIds: [rooms.r1] });
  const outScope = await seedBooking({
    property: otherPropertyId,
    roomType: roomTypes.other,
    assignRoomIds: [rooms.x1],
  });
  const scoped = await staffToken('scoped');
  const options = await get(`/api/v1/bookings/${inScope.id}/relocation-options`, scoped);
  guardRoute(options, 'GET /bookings/{id}/relocation-options');
  expect(options.status).toBe(200);
  const raw = JSON.stringify(options.body);
  expect(raw).not.toContain(outScope.id);
  expect(raw.match(/keepScore/gu) ?? []).toHaveLength(0);
  expect(etagOf(options).length).toBeGreaterThan(0);
  const foreign = await get(`/api/v1/bookings/${outScope.id}/relocation-options`, scoped);
  expect([403, 404]).toContain(foreign.status);

  const token = await staffToken('desk');
  const proposal = await proposeMove(
    token,
    moveBody(inScope.id, inScope.bookingRoomIds[0]!, rooms.r2),
  );
  const read = await get(`${MOVES}/${proposal.id}`, scoped);
  expect(read.status).toBe(200);
  const view = moveViewSchema.parse(read.body);
  expect(etagOf(read).length).toBeGreaterThan(0);
  expect(view.allowedActions).toContain('EXECUTE');
  expect(view.operationId ?? '').not.toBe('');
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [userIds.scoped]);
  expect((await get(`${MOVES}/${proposal.id}`, scoped)).status).toBe(403);
});
