/**
 * HB-015 — hàm dùng chung `requirePinToken`: tiêu thụ `pinToken` dùng một lần trong transaction
 * của caller, gắn user + purpose + booking, đòi phiên cấp token còn sống.
 */
import { expect, test } from 'vitest';
import { pinTokenSchema } from '@pinehill/contracts';
import { clock, rows, secondUserId, userId } from '../idempotency/database.js';
import { booking } from '../room-blocks/inventory-seed.js';
import { hashPinToken } from '../../src/modules/auth/pin/token.js';
import { PIN, consume, http, latestSessionId, setPin, staffToken, verify } from './fixture.js';

test('dùng một lần, đúng booking, đúng người, token lạ bị từ chối', async () => {
  const token = await staffToken();
  await setPin(token);
  const first = await booking();
  const second = await booking();
  const issued = pinTokenSchema.parse(
    (await verify(token, { pin: PIN, bookingId: first.id })).body,
  );

  await expect(consume(issued.pinToken, second.id)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
  await expect(consume(issued.pinToken, first.id, secondUserId)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
  await expect(consume('not-a-real-pin-token-000000000000', first.id)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
  await consume(issued.pinToken, first.id);
  await expect(consume(issued.pinToken, first.id)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
});

test('token gắn NULL không dùng được cho booking cụ thể', async () => {
  const token = await staffToken();
  await setPin(token);
  const issued = pinTokenSchema.parse((await verify(token)).body);
  const target = await booking();
  await expect(consume(issued.pinToken, target.id)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
});

test('hai consume đồng thời trên cùng token chỉ một thắng', async () => {
  const token = await staffToken();
  await setPin(token);
  const issued = pinTokenSchema.parse((await verify(token)).body);
  const results = await Promise.allSettled([
    consume(issued.pinToken, null),
    consume(issued.pinToken, null),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.filter((result) => result.status === 'rejected');
  expect(rejected).toHaveLength(1);
  const failure = rejected[0];
  if (failure === undefined || failure.status !== 'rejected')
    throw new Error('Expected exactly one rejected consumption');
  expect(failure.reason).toMatchObject({ code: 'E_AUTH_PIN_REQUIRED' });
});

test('token hết hạn bị từ chối; expires_at đúng mốc now cũng bị từ chối', async () => {
  await staffToken();
  const sessionId = await latestSessionId(userId);
  const at = clock.now();
  await rows(
    `INSERT INTO pin_grants(token_hash,user_id,session_id,purpose,booking_id,created_at,expires_at)
     VALUES($1,$2::uuid,$3::uuid,'FINANCIAL',NULL,$4,$5)`,
    [
      hashPinToken('expired-pin-token-0000000000000000'),
      userId,
      sessionId,
      new Date(at.getTime() - 10 * 60_000),
      new Date(at.getTime() - 5 * 60_000),
    ],
  );
  await expect(consume('expired-pin-token-0000000000000000', null)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });

  const exact = 'expiring-pin-token-0000000000000000';
  await rows(
    `INSERT INTO pin_grants(token_hash,user_id,session_id,purpose,booking_id,created_at,expires_at)
     VALUES($1,$2::uuid,$3::uuid,'FINANCIAL',NULL,$4,$5)`,
    [hashPinToken(exact), userId, sessionId, new Date(at.getTime() - 5 * 60_000), at],
  );
  await expect(consume(exact, null)).rejects.toMatchObject({ code: 'E_AUTH_PIN_REQUIRED' });
});

test('logout thu hồi phiên → grant chưa dùng không tiêu thụ được', async () => {
  const token = await staffToken();
  await setPin(token);
  const issued = pinTokenSchema.parse((await verify(token)).body);
  const logout = await http().post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);
  expect(logout.status).toBe(204);
  await expect(consume(issued.pinToken, null)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
});

test('đặt lại PIN thu hồi grant chưa dùng', async () => {
  const token = await staffToken();
  await setPin(token);
  const issued = pinTokenSchema.parse((await verify(token)).body);
  expect((await setPin(token, '654321')).status).toBe(204);
  await expect(consume(issued.pinToken, null)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
});

test('xoá PIN thu hồi grant chưa dùng của người đó', async () => {
  const target = await staffToken('h029-second', 'FRONT_DESK');
  await setPin(target);
  const issued = pinTokenSchema.parse((await verify(target)).body);
  const manager = await staffToken('h029-first', 'MANAGER');
  const removed = await http()
    .delete(`/api/v1/users/${secondUserId}/pin`)
    .set('Authorization', `Bearer ${manager}`);
  expect(removed.status).toBe(204);
  await expect(consume(issued.pinToken, null, secondUserId)).rejects.toMatchObject({
    code: 'E_AUTH_PIN_REQUIRED',
  });
});
