/**
 * HB-243 — hai yêu cầu của frontend:
 *  1. `POST /auth/login` và `POST /auth/refresh` của nhân viên trả `role` + `propertyScope` (cùng giá trị
 *     ký trong access token) để client dựng bộ chọn cơ sở không cần gọi thêm `GET /auth/me`.
 *  4. `GET /bookings?statuses=A,B` lọc nhiều trạng thái trong một lần gọi; không dùng chung với `status`.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  bookingSummarySchema,
  listResponseSchema,
  tokenPairSchema,
  userMeSchema,
} from '@pinehill/contracts';
import { password } from '../idempotency/database.js';
import { createBooking, http, listRequest, rows, staffToken, userId } from './fixture.js';
import { codeOf } from './shared.js';

const pageOf = (body: unknown) => listResponseSchema(bookingSummarySchema).parse(body);

test('HB243_staff_login_and_refresh_return_role_and_property_scope', async () => {
  await rows("UPDATE users SET role='FRONT_DESK' WHERE id=$1::uuid", [userId]);
  const login = await http().post('/api/v1/auth/login').send({ username: 'h029-first', password });
  expect(login.status).toBe(200);
  const pair = tokenPairSchema.parse(login.body);
  const scoped = (
    await rows('SELECT property_id::text AS id FROM user_property_scopes WHERE user_id=$1::uuid', [
      userId,
    ])
  )
    .map((row) => String(row.id))
    .sort();
  expect(pair.role).toBe('FRONT_DESK');
  expect([...(pair.propertyScope ?? [])].sort()).toEqual(scoped);
  expect(scoped.length).toBeGreaterThan(0);

  // Khớp đúng `GET /auth/me` (nguồn mà client đang dùng).
  const me = userMeSchema.parse(
    (await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${pair.accessToken}`)).body,
  );
  expect([...me.propertyScope].sort()).toEqual(scoped);

  const refreshed = await http()
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: pair.refreshToken });
  expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
  const next = tokenPairSchema.parse(refreshed.body);
  expect(next.role).toBe('FRONT_DESK');
  expect([...(next.propertyScope ?? [])].sort()).toEqual(scoped);
});

test('HB243_bookings_filter_by_several_statuses_in_one_call', async () => {
  const held = await createBooking();
  const confirmed = await createBooking({}, { checkIn: '2026-11-10', checkOut: '2026-11-12' });
  const cancelled = await createBooking({}, { checkIn: '2026-11-20', checkOut: '2026-11-21' });
  await rows("UPDATE bookings SET status='CONFIRMED', hold_expires_at=NULL WHERE id=$1::uuid", [
    confirmed.booking.id,
  ]);
  await rows(
    "UPDATE bookings SET status='CANCELLED', cancelled_at=clock_timestamp(), hold_expires_at=NULL WHERE id=$1::uuid",
    [cancelled.booking.id],
  );
  const token = await staffToken('FRONT_DESK');

  const both = await listRequest({ statuses: 'HELD,CONFIRMED' }, { token });
  expect(both.status, JSON.stringify(both.body)).toBe(200);
  expect(
    pageOf(both.body)
      .data.map((item) => item.id)
      .sort(),
  ).toEqual([held.booking.id, confirmed.booking.id].sort());
  expect(pageOf(both.body).meta.total).toBe(2);

  const one = await listRequest({ statuses: 'CANCELLED' }, { token });
  expect(pageOf(one.body).data.map((item) => item.id)).toEqual([cancelled.booking.id]);

  for (const query of [
    { statuses: 'HELD,NOPE' },
    { statuses: 'HELD,' },
    { statuses: 'HELD', status: 'HELD' },
  ]) {
    const bad = await listRequest(query, { token });
    expect(bad.status, JSON.stringify(query)).toBe(400);
    expect(codeOf(bad.body)).toBe('E_GEN_VALIDATION_FAILED');
  }
  expect(z.string().parse(held.booking.id)).toBeTruthy();
});
