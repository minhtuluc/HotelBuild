/**
 * HB-242 (TD-09) — `GET /operations/day-board`: khách đến/đi/ở, ca quá tải mở và kênh `DEGRADED` của một
 * cơ sở × một ngày nghiệp vụ VN. Trước đây SCR-23 chỉ hiện được tồn khả dụng vì không tuyến nào trả các
 * nhóm này.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { dayBoardSchema, errorBodySchema } from '@pinehill/contracts';
import { propertyId } from '../idempotency/database.js';
import { D, NIGHTLY, day, http, rows, seedBooking, staffToken } from './fixture.js';

const board = (token: string, query: Record<string, string>) =>
  http().get('/api/v1/operations/day-board').set('Authorization', `Bearer ${token}`).query(query);

const codes = (group: { items: { bookingId: string }[] }) =>
  group.items.map((item) => item.bookingId).sort();

test('HB242_groups_arrivals_departures_in_house_by_business_date', async () => {
  const arriving = await seedBooking({ status: 'CONFIRMED', checkIn: D, checkOut: day(D, 2) });
  const arrivedToday = await seedBooking({ status: 'CHECKED_IN', checkIn: D, checkOut: day(D, 1) });
  const leaving = await seedBooking({ status: 'CHECKED_IN', checkIn: day(D, -2), checkOut: D });
  const left = await seedBooking({ status: 'CHECKED_OUT', checkIn: day(D, -1), checkOut: D });
  const staying = await seedBooking({
    status: 'CHECKED_IN',
    checkIn: day(D, -1),
    checkOut: day(D, 1),
    paid: NIGHTLY,
  });
  // Không thuộc bảng ngày D: huỷ, giữ chỗ, đến ngày khác.
  await seedBooking({ status: 'CANCELLED', checkIn: D, checkOut: day(D, 1) });
  await seedBooking({ status: 'HELD', checkIn: D, checkOut: day(D, 1) });
  await seedBooking({ status: 'CONFIRMED', checkIn: day(D, 3), checkOut: day(D, 4) });

  const response = await board(await staffToken('FRONT_DESK'), { propertyId, date: D });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const body = dayBoardSchema.parse(response.body);
  expect(body).toMatchObject({ propertyId, date: D });

  expect(body.arrivals.total).toBe(2);
  expect(codes(body.arrivals)).toEqual([arriving.id, arrivedToday.id].sort());
  expect(body.departures.total).toBe(2);
  expect(codes(body.departures)).toEqual([leaving.id, left.id].sort());
  // Ở qua đêm D: check_in ≤ D < check_out, CONFIRMED/CHECKED_IN.
  expect(codes(body.inHouse)).toEqual([arriving.id, arrivedToday.id, staying.id].sort());
  expect(body.inHouse.truncated).toBe(false);

  const stay = body.inHouse.items.find((item) => item.bookingId === staying.id);
  expect(stay).toMatchObject({
    status: 'CHECKED_IN',
    checkIn: day(D, -1),
    checkOut: day(D, 1),
    roomCount: 1,
    // Hai đêm × NIGHTLY, đã trả một đêm (sổ cái do fixture dựng).
    balanceDue: NIGHTLY,
  });
  expect(stay?.guestName.length).toBeGreaterThan(0);
  // Không lộ SĐT/giấy tờ trên bảng ngày (UI-14).
  expect(JSON.stringify(body)).not.toMatch(/"phone"|"idNumber"/);
});

test('HB242_open_overbooking_cases_and_degraded_channels', async () => {
  const seeded = await seedBooking({ status: 'CONFIRMED', checkIn: D, checkOut: day(D, 1) });
  const roomTypeId = String(
    (await rows('SELECT room_type_id::text AS id FROM bookings WHERE id=$1', [seeded.id]))[0]!.id,
  );
  const insertCase = (date: string, status: string) =>
    rows(
      `INSERT INTO overbooking_cases(property_id,date,room_type_id,shortage_count,status,escalated_at)
       VALUES($1,$2,$3,1,$4,CASE WHEN $4='ESCALATED' THEN clock_timestamp() END)`,
      [propertyId, date, roomTypeId, status],
    );
  await rows('DELETE FROM overbooking_cases WHERE property_id=$1', [propertyId]);
  await insertCase(D, 'OPEN');
  await insertCase(day(D, 2), 'ESCALATED');
  await insertCase(day(D, -1), 'OPEN'); // đêm đã qua: không tính "từ ngày D".
  // CSDL test dựng mới chỉ có kênh của fixture: tự tạo một kênh ACTIVE và một kênh INACTIVE đang lỗi.
  const degrade = (code: string, status: string) =>
    rows(
      `INSERT INTO channels(code,name,multiplier,status,sync_status,consecutive_sync_failures)
       VALUES($1,$1,1,$2,'DEGRADED',3)
       ON CONFLICT (code) DO UPDATE SET status=$2, sync_status='DEGRADED', consecutive_sync_failures=3`,
      [code, status],
    );
  await degrade('OTA_AGODA', 'ACTIVE');
  await degrade('OTA_AIRBNB', 'INACTIVE');
  try {
    const body = dayBoardSchema.parse(
      (await board(await staffToken('MANAGER'), { propertyId, date: D })).body,
    );
    expect(body.overbooking).toEqual({ openFromDate: 2, onDate: 1 });
    expect(body.degradedChannels).toEqual([
      expect.objectContaining({ code: 'OTA_AGODA', consecutiveFailures: 3 }),
    ]);
  } finally {
    await rows(
      "UPDATE channels SET sync_status='OK', consecutive_sync_failures=0 WHERE code IN ('OTA_AGODA','OTA_AIRBNB')",
    );
    await rows('DELETE FROM overbooking_cases WHERE property_id=$1', [propertyId]);
  }
});

test('HB242_default_date_is_vn_business_today_of_database_clock', async () => {
  const today = String(
    (
      await rows(
        "SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') AS today",
      )
    )[0]!.today,
  );
  const response = await board(await staffToken('OWNER'), { propertyId });
  expect(response.status).toBe(200);
  const body = dayBoardSchema.parse(response.body);
  expect(body.date).toBe(today);
  expect(Date.parse(body.capturedAt)).toBeGreaterThan(0);
});

test('HB242_roles_scope_and_input', async () => {
  for (const role of ['HOUSEKEEPING', 'ACCOUNTANT', 'SYSADMIN']) {
    const denied = await board(await staffToken(role), { propertyId, date: D });
    expect(denied.status, role).toBe(403);
  }
  const owner = await staffToken('OWNER');
  expect((await board(owner, { propertyId: randomUUID(), date: D })).status).toBe(404);
  expect((await board(owner, { propertyId, date: '13/11/2026' })).status).toBe(400);
  expect((await board(owner, { date: D })).status).toBe(400);
  const outside = await board(await staffToken('FRONT_DESK'), {
    propertyId: randomUUID(),
    date: D,
  });
  expect(outside.status).toBe(403);
  expect(errorBodySchema.parse(outside.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
});
