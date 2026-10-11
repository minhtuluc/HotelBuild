import { expect, test } from 'vitest';
import { z } from 'zod';
import { housekeepingTaskSchema, listResponseSchema, errorBodySchema } from '@pinehill/contracts';
import {
  list,
  login,
  rows,
  ownTask,
  secondTask,
  propertyId,
  otherPropertyId,
  secondUserId,
} from './fixture.js';
const decode = listResponseSchema(housekeepingTaskSchema);
const rawList = z.object({ data: z.array(z.record(z.string(), z.unknown())) });
// Catches missing assignment/scope predicates or spreading DB rows into the public DTO.
test('HOUSEKEEPING sees only assigned tasks in scope and exactly task fields, with no-store', async () => {
  const response = await list(await login('HOUSEKEEPING'));
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(decode.parse(response.body).data.map((task) => task.id)).toEqual([ownTask]);
  expect(Object.keys(rawList.parse(response.body).data[0]!).sort()).toEqual(
    [
      'id',
      'roomId',
      'roomCode',
      'businessDate',
      'status',
      'assignedTo',
      'note',
      'completedAt',
      'version',
    ].sort(),
  );
  expect(decode.parse(response.body).meta).toEqual({
    limit: 50,
    total: 1,
    hasMore: false,
    nextCursor: null,
  });
});
test('assignment filters never widen housekeeping access; explicit outside property is denied', async () => {
  const token = await login('HOUSEKEEPING');
  expect(decode.parse((await list(token, { assignedTo: secondUserId })).body).data).toEqual([]);
  expect((await list(token, { propertyId: otherPropertyId })).status).toBe(403);
  expect((await list(token, { cursor: secondTask })).status).toBe(400);
});
test.each(['FRONT_DESK', 'MANAGER', 'OWNER'])(
  '%s may read scoped task facts; pagination stays filtered',
  async (role) => {
    const token = await login(role);
    const first = await list(token, { propertyId, limit: 1 });
    expect(first.status).toBe(200);
    const body = decode.parse(first.body);
    expect(body.meta).toMatchObject({ total: 2, hasMore: true, limit: 1 });
    const next = decode.parse(
      (await list(token, { propertyId, limit: 1, cursor: body.meta.nextCursor! })).body,
    );
    expect(new Set([...body.data, ...next.data].map((task) => task.id))).toEqual(
      new Set([ownTask, secondTask]),
    );
    expect(next.meta).toMatchObject({ total: 2, hasMore: false, nextCursor: null });
    expect(
      decode
        .parse((await list(token, { propertyId, assignedTo: secondUserId })).body)
        .data.map((task) => task.id),
    ).toEqual([secondTask]);
    expect(decode.parse((await list(token, { propertyId, status: 'DONE' })).body).data).toEqual([]);
  },
);
test.each(['ACCOUNTANT', 'RESERVATION_AGENT', 'SYSADMIN'])(
  '%s cannot read housekeeping task data',
  async (role) => {
    const result = await list(await login(role));
    expect(result.status).toBe(403);
    expect(errorBodySchema.parse(result.body).code).toBe('E_RBAC_FORBIDDEN');
  },
);
test('calendar dates, IDs, cursor and unknown query keys are validated', async () => {
  const token = await login('FRONT_DESK');
  for (const query of [
    { businessDate: '2026-02-30' },
    { businessDate: '2026-13-01' },
    { propertyId: 'bad' },
    { assignedTo: 'bad' },
    { cursor: 'bad' },
    { limit: 101 },
    { injected: 'x' },
  ])
    expect((await list(token, query)).status).toBe(400);
  expect((await list(token, { businessDate: '2028-02-29' })).status).toBe(200);
});
test('legacy note identifiers are masked in read projections', async () => {
  await rows('UPDATE housekeeping_tasks SET note=$1 WHERE id=$2', [
    'Synthetic +84912345678 test@example.test CCCD 012345678901',
    ownTask,
  ]);
  const result = await list(await login('HOUSEKEEPING'));
  expect(result.status).toBe(200);
  const note = decode.parse(result.body).data[0]!.note!;
  expect(note).toContain('****5678');
  expect(note).toContain('****8901');
  expect(JSON.stringify(result.body)).not.toMatch(/84912345678|012345678901|test@example/);
});
test('legacy passport/idNumber labels are masked before housekeeping sees a note', async () => {
  await rows('UPDATE housekeeping_tasks SET note=$1 WHERE id=$2', [
    'Passport B1234567; idNumber AB123456; Hộ chiếu: C7654321',
    ownTask,
  ]);
  const response = await list(await login('HOUSEKEEPING'));
  expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toMatch(/B1234567|AB123456|C7654321/);
  expect(decode.parse(response.body).data[0]!.note).toContain('****4567');
});
