import { beforeEach, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tokenPairSchema } from '@pinehill/contracts';
import { password } from '../idempotency/database.js';
import { http, login } from '../room-blocks/http-fixture.js';
import {
  rows,
  roomId,
  room2Id,
  otherRoomId,
  userId,
  secondUserId,
} from '../room-blocks/inventory-seed.js';
export { http, login, rows, roomId, userId, secondUserId };
export { propertyId, otherPropertyId, db, clock } from '../room-blocks/inventory-seed.js';
export const date = '2026-11-01';
export let ownTask = '',
  secondTask = '',
  outsideTask = '';
beforeEach(async () => {
  await rows('DELETE FROM housekeeping_tasks');
  await rows("UPDATE users SET role='HOUSEKEEPING' WHERE id=ANY($1::uuid[])", [
    [userId, secondUserId],
  ]);
  for (const [room, assignee] of [
    [roomId, userId],
    [room2Id, secondUserId],
    [otherRoomId, userId],
  ]) {
    const id = String(
      (
        await rows(
          'INSERT INTO housekeeping_tasks(room_id,business_date,assigned_to,note) VALUES($1,$2,$3,$4) RETURNING id',
          [room, date, assignee, 'Synthetic room task'],
        )
      )[0]!.id,
    );
    if (room === roomId) ownTask = id;
    else if (room === room2Id) secondTask = id;
    else outsideTask = id;
  }
});
export async function secondLogin(role = 'HOUSEKEEPING') {
  await rows('UPDATE users SET role=$1 WHERE id=$2', [role, secondUserId]);
  const result = await http()
    .post('/api/v1/auth/login')
    .send({ username: 'h029-second', password });
  expect(result.status).toBe(200);
  return tokenPairSchema.parse(result.body).accessToken;
}
export const list = (token: string, query: Record<string, string | number> = {}) =>
  http()
    .get('/api/v1/housekeeping/tasks')
    .set('Authorization', `Bearer ${token}`)
    .query({ businessDate: date, ...query });
export const patch = (
  token: string,
  body: Record<string, unknown>,
  id = ownTask,
  version: string | null = '"1"',
  key = randomUUID(),
) => {
  const request = http()
    .patch(`/api/v1/housekeeping/tasks/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key);
  if (version !== null) request.set('If-Match', version);
  return request.send(body);
};
