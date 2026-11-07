/**
 * TD-20: `POST /auth/password` phải đếm sai và khoá như đăng nhập (BR-RBAC-06). Trước đây `currentPassword`
 * sai không được đếm nên người giữ access token dò mật khẩu không giới hạn qua endpoint này.
 * Dùng chung fixture của HB-013 (không sửa file khoá): đồng hồ giả, PG16/Redis7 thật, mỗi test một user.
 */
import { verify } from '@node-rs/argon2';
import request from 'supertest';
import { expect, test } from 'vitest';
import { errorBodySchema, tokenPairSchema } from '@pinehill/contracts';
import {
  auditSequence,
  clock,
  error,
  expectAudit,
  login,
  loginRequest,
  password,
  refresh,
  rows,
  server,
  userId,
  username,
} from './staff-auth.locked.fixture.js';

const WRONG = 'Wrong-password-020!';
const NEXT = 'New-synthetic-password-020!';

const change = (token: string, currentPassword: string) =>
  request(server)
    .post('/api/v1/auth/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword, newPassword: NEXT });

async function counters() {
  return (
    await rows('SELECT failed_login_count,locked_until FROM users WHERE id=$1::uuid', [userId])
  )[0];
}

async function storedHash(): Promise<string> {
  const value = (await rows('SELECT password_hash FROM users WHERE id=$1::uuid', [userId]))[0]
    ?.password_hash;
  if (typeof value !== 'string') throw new Error('Missing password hash');
  return value;
}

test('năm lần currentPassword sai thì khoá; lần thứ sáu dù đúng cũng bị khoá và mật khẩu không đổi', async () => {
  const pair = await login();
  const before = await storedHash();
  const sequence = await auditSequence();
  for (let i = 0; i < 5; i++)
    error(await change(pair.accessToken, WRONG), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect(await counters()).toMatchObject({
    failed_login_count: 5,
    locked_until: new Date(clock.value + 900000),
  });
  const locked = error(await change(pair.accessToken, password), 401, 'E_AUTH_ACCOUNT_LOCKED');
  expect(locked.retryAfterSeconds).toBe(900);
  expect(await storedHash()).toBe(before);
  await expectAudit(sequence, 'AUTH_PASSWORD_CHANGE_FAILURE', true);
  await expectAudit(sequence, 'AUTH_PASSWORD_CHANGE_LOCKED', true);
});

test('hết 15 phút thì đổi được bằng mật khẩu đúng và bộ đếm về 0', async () => {
  const pair = await login('OPS_ANDROID');
  for (let i = 0; i < 5; i++)
    error(await change(pair.accessToken, WRONG), 401, 'E_AUTH_INVALID_CREDENTIALS');
  clock.advance(900001);
  // OPS_ANDROID không có hạn nhàn rỗi 15 phút của OPS_WEB; access token đã hết hạn nên `refresh` cấp token mới mà không đụng bộ đếm (đăng nhập sẽ tự xoá nó).
  const renewed = tokenPairSchema.parse((await refresh(pair.refreshToken)).body);
  expect(await counters()).toMatchObject({ failed_login_count: 5 });
  expect((await change(renewed.accessToken, password)).status).toBe(204);
  expect(await counters()).toMatchObject({ failed_login_count: 0, locked_until: null });
  expect(await verify(await storedHash(), NEXT)).toBe(true);
});

test('đổi mật khẩu thành công xoá chuỗi sai liên tiếp', async () => {
  const pair = await login();
  for (let i = 0; i < 4; i++)
    error(await change(pair.accessToken, WRONG), 401, 'E_AUTH_INVALID_CREDENTIALS');
  expect((await change(pair.accessToken, password)).status).toBe(204);
  expect(await counters()).toMatchObject({ failed_login_count: 0, locked_until: null });
});

test('bộ đếm dùng chung với đăng nhập: 3 sai ở đổi mật khẩu + 2 sai ở đăng nhập thì khoá cả hai', async () => {
  const pair = await login();
  for (let i = 0; i < 3; i++)
    error(await change(pair.accessToken, WRONG), 401, 'E_AUTH_INVALID_CREDENTIALS');
  for (let i = 0; i < 2; i++)
    error(await loginRequest(username, WRONG), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await loginRequest(), 401, 'E_AUTH_ACCOUNT_LOCKED');
  error(await change(pair.accessToken, password), 401, 'E_AUTH_ACCOUNT_LOCKED');
});

test('tài khoản đã bị khoá do đăng nhập thì đổi mật khẩu cũng bị chặn', async () => {
  const pair = await login();
  for (let i = 0; i < 5; i++)
    error(await loginRequest(username, WRONG), 401, 'E_AUTH_INVALID_CREDENTIALS');
  error(await change(pair.accessToken, password), 401, 'E_AUTH_ACCOUNT_LOCKED');
});

test('đoán song song không vượt ngưỡng: đúng 5 lần sai được tính, phần còn lại bị khoá', async () => {
  const pair = await login();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => change(pair.accessToken, WRONG)),
  );
  const codes = responses.map((response) => errorBodySchema.parse(response.body).code);
  expect(codes.filter((code) => code === 'E_AUTH_INVALID_CREDENTIALS')).toHaveLength(5);
  expect(codes.filter((code) => code === 'E_AUTH_ACCOUNT_LOCKED')).toHaveLength(3);
  expect(await counters()).toMatchObject({ failed_login_count: 5 });
});
