import { expect, test } from 'vitest';
import {
  login,
  rows,
  db,
  userId,
  propId,
  roomId,
  secondRoomId,
  typeId,
  tag,
  write,
} from './fixture.js';
async function waitForWriter() {
  for (let n = 0; n < 100; n++) {
    const found = await rows(
      "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM properties%FOR UPDATE%'",
    );
    if (found.length) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Real PROP writer did not reach the held PostgreSQL resource lock');
}
test('two current property commands have one success and one version conflict, one audit', async () => {
  const token = await login(),
    version = await tag('properties', propId, token),
    n = Number(
      (await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1', [propId]))[0]!.n,
    );
  const results = await Promise.all(
    ['A', 'B'].map((s) =>
      write(
        'patch',
        'properties/' + propId,
        token,
        { name: 'Synthetic ' + s, reason: 'Synthetic' },
        version,
      ),
    ),
  );
  expect(results.map((x) => x.status).sort()).toEqual([200, 412]);
  expect(
    Number((await rows('SELECT count(*) AS n FROM audit_logs WHERE entity_id=$1', [propId]))[0]!.n),
  ).toBe(n + 1);
});
test('same source concurrent links have one200 and one412, with a reciprocal final graph', async () => {
  const token = await login('MANAGER'),
    version = await tag('rooms', roomId, token),
    third = String(
      (
        await rows(
          'SELECT id FROM rooms WHERE room_type_id=$1 AND id<>ALL($2::uuid[]) ORDER BY code LIMIT 1',
          [typeId, [roomId, secondRoomId]],
        )
      )[0]!.id,
    );
  const results = await Promise.all(
    [secondRoomId, third].map((target) =>
      write(
        'put',
        'rooms/' + roomId + '/connecting-room',
        token,
        { connectingRoomId: target },
        version,
      ),
    ),
  );
  expect(results.map((x) => x.status).sort()).toEqual([200, 412]);
  const graph = await rows('SELECT id,connecting_room_id FROM rooms WHERE property_id=$1', [
      propId,
    ]),
    byId = new Map(graph.map((x) => [x.id, x.connecting_room_id]));
  for (const row of graph)
    if (row.connecting_room_id) expect(byId.get(row.connecting_room_id)).toBe(row.id);
  expect(graph.filter((x) => x.connecting_room_id !== null)).toHaveLength(2);
});
for (const revoke of ['role', 'scope'])
  test(`${revoke} revoke while writer waits on real lock denies mutation`, async () => {
    const token = await login('MANAGER'),
      version = await tag('rooms', roomId, token),
      held = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM properties WHERE id=${propId}::uuid FOR UPDATE`;
        held.resolve();
        await release.promise;
      },
      { timeout: 10000 },
    );
    await held.promise;
    const pending = write(
      'patch',
      'rooms/' + roomId,
      token,
      { floor: 9, reason: 'Synthetic' },
      version,
    ).then((x) => x);
    try {
      await waitForWriter();
      if (revoke === 'role')
        await rows("UPDATE users SET role='HOUSEKEEPING' WHERE id=$1", [userId]);
      else await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
    } finally {
      release.resolve();
      await holder;
    }
    const result = await pending;
    expect(result.status).toBe(403);
    const row = (await rows('SELECT floor FROM rooms WHERE id=$1', [roomId]))[0]!;
    expect(row.floor).not.toBe(9);
  });
test('failure on one reciprocal partner audit rolls back the whole link and both tokens', async () => {
  const token = await login('MANAGER'),
    a = await tag('rooms', roomId, token),
    b = await tag('rooms', secondRoomId, token);
  const literal = String((await rows('SELECT quote_literal($1) AS v', [secondRoomId]))[0]!.v);
  await rows(
    'ALTER TABLE audit_logs ADD CONSTRAINT hb033_partner_reject CHECK(entity_id <> ' +
      literal +
      '::uuid) NOT VALID',
  );
  try {
    expect(
      (
        await write(
          'put',
          'rooms/' + roomId + '/connecting-room',
          token,
          { connectingRoomId: secondRoomId },
          a,
        )
      ).status,
    ).toBe(500);
    expect(await tag('rooms', roomId, token)).toBe(a);
    expect(await tag('rooms', secondRoomId, token)).toBe(b);
    expect(
      (
        await rows('SELECT connecting_room_id FROM rooms WHERE id=ANY($1::uuid[])', [
          [roomId, secondRoomId],
        ])
      ).every((x) => x.connecting_room_id === null),
    ).toBe(true);
  } finally {
    await rows('ALTER TABLE audit_logs DROP CONSTRAINT hb033_partner_reject');
  }
});
test('room token preserves microseconds and repeated writes increase strictly without Clock progress', async () => {
  const token = await login('MANAGER');
  await rows("UPDATE rooms SET updated_at='2030-01-01T00:00:00.123456Z' WHERE id=$1", [roomId]);
  const before = await tag('rooms', roomId, token);
  expect(before).toBe('"1893456000123456"');
  const first = await write('patch', 'rooms/' + roomId, token, { floor: 3 }, before);
  expect(first.status).toBe(200);
  expect(first.headers.etag).toBe('"1893456000123457"');
  const second = await write('patch', 'rooms/' + roomId, token, { floor: 4 }, first.headers.etag!);
  expect(second.status).toBe(200);
  expect(second.headers.etag).toBe('"1893456000123458"');
  expect((await write('patch', 'rooms/' + roomId, token, { floor: 5 }, before)).status).toBe(412);
});
