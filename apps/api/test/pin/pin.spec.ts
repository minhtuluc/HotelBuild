/**
 * HB-015 — endpoint PIN: `POST /auth/pin/verify`, `PUT /auth/pin`, `DELETE /users/{userId}/pin`.
 * Hàm dùng chung `requirePinToken` kiểm riêng ở `consume.spec.ts`.
 */
import { expect, test } from 'vitest';
import { errorBodySchema, pinTokenSchema } from '@pinehill/contracts';
import { serializeSafeRequest } from '../../src/common/safe-request.js';
import {
  clock,
  otherPropertyId,
  password,
  rows,
  secondUserId,
  userId,
} from '../idempotency/database.js';
import { booking, otherTypeId } from '../room-blocks/inventory-seed.js';
import { PIN, UNKNOWN_ID, errorCode, http, setPin, staffToken, verify } from './fixture.js';

test('PIN chưa đặt → verify trả E_AUTH_PIN_REQUIRED', async () => {
  const response = await verify(await staffToken());
  expect(response.status).toBe(401);
  expect(errorCode(response)).toBe('E_AUTH_PIN_REQUIRED');
});

test('đặt PIN cần currentPassword; đúng thì verify trả pinToken 32 byte + ghi audit', async () => {
  const token = await staffToken();
  const rejected = await setPin(token, PIN, 'Wrong-password-123');
  expect(rejected.status).toBe(401);
  expect(errorCode(rejected)).toBe('E_AUTH_INVALID_CREDENTIALS');
  const saved = await setPin(token);
  expect(saved.status).toBe(204);

  const response = await verify(token);
  expect(response.status).toBe(200);
  const grant = pinTokenSchema.parse(response.body);
  expect(grant.pinToken).toHaveLength(64);
  expect(Date.parse(grant.expiresAt)).toBeGreaterThan(clock.now().getTime());

  const audited = await rows(
    "SELECT count(*)::int AS n FROM audit_logs WHERE action='AUTH_PIN_SET' AND entity_id=$1::uuid",
    [userId],
  );
  expect(Number(audited[0]!.n)).toBeGreaterThan(0);
});

test('sai PIN 3 lần → E_AUTH_PIN_LOCKED + retryAfterSeconds; mở lại sau 15 phút', async () => {
  let token = await staffToken();
  expect((await setPin(token)).status).toBe(204);
  for (let attempt = 0; attempt < 2; attempt++) {
    const wrong = await verify(token, { pin: '000000' });
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong)).toBe('E_AUTH_PIN_REQUIRED');
  }
  const locked = await verify(token, { pin: '000000' });
  expect(locked.status).toBe(403);
  const body = errorBodySchema.parse(locked.body);
  expect(body.code).toBe('E_AUTH_PIN_LOCKED');
  expect(body.retryAfterSeconds).toBeGreaterThan(0);

  // Thao tác không cần PIN vẫn dùng được trong lúc khoá (QĐ-03 quyết định 4).
  const me = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
  expect(me.status).toBe(200);

  const stillLocked = await verify(token, { pin: PIN });
  expect(stillLocked.status).toBe(403);
  expect(errorCode(stillLocked)).toBe('E_AUTH_PIN_LOCKED');

  clock.value += 16 * 60_000;
  token = await staffToken();
  expect((await verify(token, { pin: PIN })).status).toBe(200);
});

test('PIN không xuất hiện trong audit_logs', async () => {
  const token = await staffToken();
  await setPin(token);
  await verify(token, { pin: '000000' });
  const leaked = await rows(
    "SELECT count(*)::int AS n FROM audit_logs WHERE after_json::text LIKE '%123456%' OR before_json::text LIKE '%123456%'",
  );
  expect(Number(leaked[0]!.n)).toBe(0);
});

test('bộ tuần tự hoá log chỉ giữ method/url/id — không có PIN hay pinToken', () => {
  const serialized = serializeSafeRequest({
    method: 'POST',
    url: '/api/v1/auth/pin/verify?token=secret',
    id: 'trace-1',
    headers: { authorization: 'Bearer synthetic' },
    body: { pin: PIN, pinToken: 'sensitive-pin-token-value' },
  });
  expect(serialized).toEqual({ method: 'POST', url: '/api/v1/auth/pin/verify', id: 'trace-1' });
  expect(JSON.stringify(serialized)).not.toContain(PIN);
  expect(JSON.stringify(serialized)).not.toContain('sensitive-pin-token-value');
});

test('HOUSEKEEPING và SYSADMIN bị 403 ở pin/verify', async () => {
  const housekeeping = await verify(await staffToken('h029-first', 'HOUSEKEEPING'));
  expect(housekeeping.status).toBe(403);
  expect(errorCode(housekeeping)).toBe('E_RBAC_FORBIDDEN');
  const sysadmin = await verify(await staffToken('h029-second', 'SYSADMIN'));
  expect(sysadmin.status).toBe(403);
  expect(errorCode(sysadmin)).toBe('E_RBAC_FORBIDDEN');
});

test('verify gắn booking trong cơ sở; booking ngoài cơ sở 403; booking lạ 404', async () => {
  const token = await staffToken();
  await setPin(token);
  const mine = await booking();
  expect((await verify(token, { pin: PIN, bookingId: mine.id })).status).toBe(200);
  const foreign = await booking({ property: otherPropertyId, type: otherTypeId });
  const denied = await verify(token, { pin: PIN, bookingId: foreign.id });
  expect(denied.status).toBe(403);
  expect(errorCode(denied)).toBe('E_AUTH_OUT_OF_SCOPE');
  const unknown = await verify(token, { pin: PIN, bookingId: UNKNOWN_ID });
  expect(unknown.status).toBe(404);
  expect(errorCode(unknown)).toBe('E_GEN_NOT_FOUND');
});

test('PUT /auth/pin: thân sai → 400', async () => {
  const response = await setPin(await staffToken(), '12', 'x');
  expect(response.status).toBe(400);
  expect(errorCode(response)).toBe('E_GEN_VALIDATION_FAILED');
});

test('PUT /auth/pin: sai currentPassword đếm vào khoá đăng nhập, khoá chặn cả mật khẩu đúng', async () => {
  const token = await staffToken();
  for (let attempt = 0; attempt < 5; attempt++) {
    const rejected = await setPin(token, '654321', 'Wrong-password-123');
    expect(rejected.status).toBe(401);
    expect(errorCode(rejected)).toBe('E_AUTH_INVALID_CREDENTIALS');
  }
  const locked = await setPin(token, '654321', password);
  expect(locked.status).toBe(401);
  const body = errorBodySchema.parse(locked.body);
  expect(body.code).toBe('E_AUTH_ACCOUNT_LOCKED');
  expect(body.retryAfterSeconds).toBeGreaterThan(0);

  clock.value += 16 * 60_000;
  const fresh = await staffToken();
  expect((await setPin(fresh)).status).toBe(204);
});

test('PUT /auth/pin: đổi PIN không xoá khoá PIN còn hiệu lực', async () => {
  let token = await staffToken();
  expect((await setPin(token)).status).toBe(204);
  for (let attempt = 0; attempt < 3; attempt++) await verify(token, { pin: '000000' });
  expect((await verify(token, { pin: PIN })).status).toBe(403);

  expect((await setPin(token, '654321')).status).toBe(204);
  const stillLocked = await verify(token, { pin: '654321' });
  expect(stillLocked.status).toBe(403);
  expect(errorCode(stillLocked)).toBe('E_AUTH_PIN_LOCKED');

  clock.value += 16 * 60_000;
  token = await staffToken();
  expect((await verify(token, { pin: '654321' })).status).toBe(200);
});

test('khoá PIN của người này không ảnh hưởng người khác', async () => {
  const first = await staffToken('h029-first', 'FRONT_DESK');
  await setPin(first);
  const second = await staffToken('h029-second', 'FRONT_DESK');
  await setPin(second);
  for (let attempt = 0; attempt < 3; attempt++) await verify(first, { pin: '000000' });
  expect((await verify(first, { pin: PIN })).status).toBe(403);
  expect((await verify(second, { pin: PIN })).status).toBe(200);
});

test('DELETE /users/{id}/pin: MANAGER cùng cơ sở xoá được, audit ghi', async () => {
  const target = await staffToken('h029-second', 'FRONT_DESK');
  await setPin(target);
  const manager = await staffToken('h029-first', 'MANAGER');
  const removed = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${manager}`);
  expect(removed.status).toBe(204);

  const again = await staffToken('h029-second', 'FRONT_DESK');
  expect((await verify(again)).status).toBe(401);
  const audited = await rows(
    "SELECT count(*)::int AS n FROM audit_logs WHERE action='AUTH_PIN_DELETED' AND entity_id=$1::uuid",
    [secondUserId],
  );
  expect(Number(audited[0]!.n)).toBeGreaterThan(0);
});

test('DELETE /users/{id}/pin: MANAGER cơ sở khác → 403 E_AUTH_OUT_OF_SCOPE', async () => {
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid', [secondUserId]);
  await rows('INSERT INTO user_property_scopes(user_id,property_id) VALUES($1::uuid,$2::uuid)', [
    secondUserId,
    otherPropertyId,
  ]);
  const manager = await staffToken('h029-first', 'MANAGER');
  const response = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${manager}`);
  expect(response.status).toBe(403);
  expect(errorCode(response)).toBe('E_AUTH_OUT_OF_SCOPE');
});

test('DELETE /users/{id}/pin: SYSADMIN xoá không giới cơ sở → 204', async () => {
  const sysadmin = await staffToken('h029-first', 'SYSADMIN');
  const response = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${sysadmin}`);
  expect(response.status).toBe(204);
});

test('DELETE /users/{id}/pin: người dùng lạ → 404; FRONT_DESK → 403', async () => {
  const sysadmin = await staffToken('h029-first', 'SYSADMIN');
  const missing = await http()
    .delete(`/api/v1/users/${UNKNOWN_ID}/pin`)
    .set('Authorization', `Bearer ${sysadmin}`);
  expect(missing.status).toBe(404);
  expect(errorCode(missing)).toBe('E_GEN_NOT_FOUND');
  const frontDesk = await staffToken('h029-first', 'FRONT_DESK');
  const denied = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${frontDesk}`);
  expect(denied.status).toBe(403);
  expect(errorCode(denied)).toBe('E_RBAC_FORBIDDEN');
});
