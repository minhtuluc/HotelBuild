/**
 * TD-58 (khách đăng xuất) và TD-59 (thu hồi phiên trên tuyến `@Public`), trên PostgreSQL/Redis thật.
 *
 * Trước đây `POST /auth/logout` là tuyến nhân viên (token khách nhận 403) và các tuyến booking/hold/báo giá
 * chỉ kiểm chữ ký+hạn của access token, nên phiên đã đăng xuất/replay vẫn dùng được tới hết hạn token.
 * Mỗi ca kiểm cả hai phía (phiên còn sống → qua, đã thu hồi → 401) để chứng minh kiểm tra thật sự phân biệt.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import type { AccessTokenClaims } from '@pinehill/contracts';
import { signAccessToken } from '../../src/infrastructure/crypto/access-tokens.js';
import {
  accessSecret,
  clock,
  error,
  http,
  login,
  pair,
  password,
  refresh,
  rows,
} from './guest-oracle.fixture.js';
import { seedGuest } from './guest-data.js';

/** `GUEST` không nằm trong `userRoleSchema`; lấy giá trị qua zod như các fixture khác (QT §2 cấm `as`). */
const GUEST_ROLE = z.custom<AccessTokenClaims['role']>((value) => value === 'GUEST').parse('GUEST');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const logout = (token?: string) => {
  const call = http().post('/api/v1/guest-auth/logout');
  return token === undefined ? call : call.set(bearer(token));
};
const listBookings = (token: string) => http().get('/api/v1/bookings').set(bearer(token));
const releaseHold = (token: string) =>
  http()
    .delete(`/api/v1/holds/${randomUUID()}`)
    .set(bearer(token))
    .set('Idempotency-Key', randomUUID());
const QUOTE = {
  propertyId: randomUUID(),
  roomTypeId: randomUUID(),
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-10',
  checkOut: '2026-12-12',
  adults: 1,
  children: 0,
  roomCount: 1,
};
const createQuote = (token: string) =>
  http().post('/api/v1/quotes').set(bearer(token)).set('Idempotency-Key', randomUUID()).send(QUOTE);

const sessionsOf = (guestId: string) =>
  rows(
    'SELECT family_id, revoked_at, revoke_reason FROM auth_sessions WHERE guest_id=$1 ORDER BY created_at',
    [guestId],
  );

async function staffLogin(): Promise<{ accessToken: string }> {
  const response = await http()
    .post('/api/v1/auth/login')
    .set('Idempotency-Key', randomUUID())
    .send({ username: 'h017-staff', password });
  expect(response.status).toBe(200);
  return pair(response.body);
}

test('khách đăng xuất: 204, thu hồi cả họ phiên; refresh và access token cũ đều bị từ chối', async () => {
  const id = await seedGuest();
  const tokens = await login();
  expect((await listBookings(tokens.accessToken)).status).toBe(200);
  expect((await logout(tokens.accessToken)).status).toBe(204);
  error(await refresh(tokens.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  // TD-59: access token còn hạn chữ ký nhưng phiên đã thu hồi.
  error(await listBookings(tokens.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  const sessions = await sessionsOf(id);
  expect(sessions.length).toBeGreaterThan(0);
  for (const row of sessions) {
    expect(row.revoked_at, 'mọi dòng của họ phiên phải thu hồi').not.toBeNull();
    expect(row.revoke_reason).toBe('LOGOUT');
  }
});

test('sau khi xoay refresh, đăng xuất bằng access token mới thu hồi cả họ (token cũ đã xoay cũng chết)', async () => {
  await seedGuest();
  const first = await login();
  const rotated = pair((await refresh(first.refreshToken)).body);
  expect((await logout(rotated.accessToken)).status).toBe(204);
  error(await refresh(rotated.refreshToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await listBookings(rotated.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});

test('đăng xuất chỉ thu hồi đúng phiên của mình; phiên khác của cùng khách vẫn dùng được', async () => {
  const id = await seedGuest();
  const a = await login();
  clock.value += 61_000;
  const b = await login();
  expect((await logout(a.accessToken)).status).toBe(204);
  error(await listBookings(a.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect((await listBookings(b.accessToken)).status).toBe(200);
  const live = (await sessionsOf(id)).filter((row) => row.revoked_at === null);
  expect(live).toHaveLength(1);
});

test('đăng xuất không có bearer, token rác hoặc phiên đã thu hồi đều 401, không đụng dữ liệu nào', async () => {
  await seedGuest();
  const tokens = await login();
  error(await logout(), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await logout('garbage.token.value'), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect((await logout(tokens.accessToken)).status).toBe(204);
  // Lần hai: phiên đã thu hồi nên 401 (cùng hành vi logout nhân viên).
  error(await logout(tokens.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});

test('token nhân viên không dùng được logout khách và không bị thu hồi nhầm', async () => {
  const staff = await staffLogin();
  error(await logout(staff.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect((await http().get('/api/v1/auth/me').set(bearer(staff.accessToken))).status).toBe(200);
});

test('TD-59 tuyến booking: phiên nhân viên đã đăng xuất bị từ chối, phiên còn sống được nhận', async () => {
  const staff = await staffLogin();
  expect((await listBookings(staff.accessToken)).status).toBe(200);
  expect((await http().post('/api/v1/auth/logout').set(bearer(staff.accessToken))).status).toBe(
    204,
  );
  error(await listBookings(staff.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});

test('TD-59 tuyến hold và báo giá: phiên còn sống qua bước xác thực, phiên đã thu hồi là 401', async () => {
  await seedGuest();
  const tokens = await login();
  // Phiên còn sống: xác thực đã qua nên lỗi (nếu có) là nghiệp vụ (hold/cơ sở không tồn tại), không phải 401.
  expect((await releaseHold(tokens.accessToken)).status).not.toBe(401);
  expect((await createQuote(tokens.accessToken)).status).not.toBe(401);
  expect((await logout(tokens.accessToken)).status).toBe(204);
  error(await releaseHold(tokens.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await createQuote(tokens.accessToken), 401, 'E_AUTH_INVALID_CREDENTIALS');
});

test('fail-closed: chữ ký đúng nhưng phiên không tồn tại trong CSDL thì bị từ chối', async () => {
  // Token KHÁCH (tuyến public không tra `users` cho khách): chỉ kiểm tra phiên mới chặn được token này.
  const id = await seedGuest();
  const { token } = await signAccessToken(
    { userId: id, role: GUEST_ROLE, propertyScope: [], sessionId: randomUUID() },
    accessSecret,
    clock.now(),
  );
  error(await listBookings(token), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await releaseHold(token), 401, 'E_AUTH_INVALID_CREDENTIALS');
});
