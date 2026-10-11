import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { z } from 'zod';
import pg from 'pg';
import { databaseUrl } from '../idempotency/database.js';
import { allotmentRowSchema, listResponseSchema, errorBodySchema } from '@pinehill/contracts';
import { http, login } from '../room-blocks/http-fixture.js';
import {
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  dormTypeId,
  otherTypeId,
  userId,
  booking,
  allotment,
} from '../room-blocks/inventory-seed.js';

const dates = ['2026-11-01', '2026-11-02', '2026-11-03'];
async function channel(code = 'OTA_BOOKING') {
  return String((await rows('SELECT id FROM channels WHERE code=$1', [code]))[0]!.id);
}
async function read(token: string, channelId: string, roomTypeId = typeId) {
  return http()
    .get('/api/v1/channel-allotments')
    .set('Authorization', `Bearer ${token}`)
    .query({ channelId, roomTypeId, from: dates[0], to: dates[2] });
}
async function write(
  token: string,
  channelId: string,
  tag: string | undefined,
  items = dates.map((date) => ({ date, allotment: 2 })),
  roomTypeId = typeId,
  key = randomUUID(),
) {
  const pending = http()
    .put('/api/v1/channel-allotments')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key);
  if (tag !== undefined) pending.set('If-Match', tag);
  return pending.send({
    channelId,
    roomTypeId,
    items,
    reason: 'Synthetic inventory configuration',
  });
}
async function auditCount() {
  return Number(
    (await rows("SELECT count(*) AS n FROM audit_logs WHERE action='ALLOTMENT_UPDATED'"))[0]!.n,
  );
}

test('GET reads configured dates and live channel demand, not the mutable used cache', async () => {
  const token = await login(),
    c = await channel();
  await allotment('OTA_BOOKING', 2);
  await rows('UPDATE channel_allotments SET used=99 WHERE channel_id=$1', [c]);
  await booking({ channel: 'OTA_BOOKING' });
  const response = await read(token, c);
  expect(response.status).toBe(200);
  expect(response.headers.etag).toMatch(/^"[1-9]\d*"$/);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(listResponseSchema(allotmentRowSchema).parse(response.body).data).toEqual([
    { date: dates[0], allotment: 2, used: 1 },
  ]);
  const tag = response.headers.etag;
  await rows('UPDATE channel_allotments SET used=0 WHERE channel_id=$1', [c]);
  expect((await read(token, c)).headers.etag).toBe(tag);
});

test('missing If-Match is 428, malformed or stale token is 412, with no configuration writes', async () => {
  const token = await login(),
    c = await channel();
  const initial = await read(token, c);
  expect(initial.status).toBe(200);
  const before = await auditCount();
  expect((await write(token, c, undefined)).status).toBe(428);
  expect((await write(token, c, 'invalid')).status).toBe(412);
  const ok = await write(token, c, initial.headers.etag);
  expect(ok.status).toBe(204);
  expect(ok.headers.etag).not.toBe(initial.headers.etag);
  expect((await write(token, c, initial.headers.etag)).status).toBe(412);
  expect(await auditCount()).toBe(before + 1);
});

test('each channel may independently allocate the full ACTIVE supply; quotas are not summed', async () => {
  const token = await login(),
    c = await channel(),
    other = await channel('OTA_AGODA');
  const before = await auditCount();
  for (const id of [c, other]) {
    const initial = await read(token, id);
    expect(initial.status).toBe(200);
    expect((await write(token, id, initial.headers.etag)).status).toBe(204);
  }
  expect(await auditCount()).toBe(before + 2);
  expect(
    Number(
      (
        await rows('SELECT sum(allotment) AS n FROM channel_allotments WHERE date=$1', [dates[0]])
      )[0]!.n,
    ),
  ).toBe(4);
});

test('409 lists ALL invalid dates and rolls back the valid item, scope version and audit', async () => {
  const token = await login(),
    c = await channel();
  const initial = await read(token, c);
  expect(initial.status).toBe(200);
  const before = await auditCount();
  const response = await write(token, c, initial.headers.etag, [
    { date: dates[0]!, allotment: 1 },
    { date: dates[1]!, allotment: 3 },
    { date: dates[2]!, allotment: 4 },
  ]);
  expect(response.status).toBe(409);
  expect(errorBodySchema.parse(response.body).code).toBe('E_INV_ALLOTMENT_EXCEEDS_ROOMS');
  expect(errorBodySchema.parse(response.body).details).toEqual([
    { field: `items[${dates[1]}].allotment`, issue: 'EXCEEDS_ACTIVE_SUPPLY' },
    { field: `items[${dates[2]}].allotment`, issue: 'EXCEEDS_ACTIVE_SUPPLY' },
  ]);
  const after = await read(token, c);
  expect(after.headers.etag).toBe(initial.headers.etag);
  expect(listResponseSchema(allotmentRowSchema).parse(after.body).data).toEqual([]);
  expect(await auditCount()).toBe(before);
});

test('DOR capacity uses six beds, not one room; seven units are rejected', async () => {
  const token = await login(),
    c = await channel();
  const initial = await read(token, c, dormTypeId);
  expect(initial.status).toBe(200);
  const ok = await write(
    token,
    c,
    initial.headers.etag,
    [{ date: dates[0]!, allotment: 6 }],
    dormTypeId,
  );
  expect(ok.status).toBe(204);
  expect(
    (await write(token, c, ok.headers.etag, [{ date: dates[0]!, allotment: 7 }], dormTypeId))
      .status,
  ).toBe(409);
});

test('same-key replay preserves ETag and records one audit; scope revocation still denies replay', async () => {
  const token = await login(),
    c = await channel(),
    key = randomUUID();
  const initial = await read(token, c);
  expect(initial.status).toBe(200);
  const before = await auditCount();
  const first = await write(token, c, initial.headers.etag, undefined, typeId, key);
  expect(first.status).toBe(204);
  const replay = await write(token, c, initial.headers.etag, undefined, typeId, key);
  expect(replay.status).toBe(204);
  expect(replay.headers.etag).toBe(first.headers.etag);
  expect(replay.headers['access-control-expose-headers']).toBe('ETag');
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(await auditCount()).toBe(before + 1);
  await rows('DELETE FROM user_property_scopes WHERE user_id=$1', [userId]);
  expect((await write(token, c, initial.headers.etag, undefined, typeId, key)).status).toBe(403);
});

test('two writers of one configuration version yield one204/one412, not two successful batches', async () => {
  const token = await login(),
    c = await channel();
  const initial = await read(token, c);
  expect(initial.status).toBe(200);
  const before = await auditCount();
  const result = await Promise.all([
    write(token, c, initial.headers.etag, [{ date: dates[0]!, allotment: 1 }]),
    write(token, c, initial.headers.etag, [{ date: dates[1]!, allotment: 2 }]),
  ]);
  expect(result.map((r) => r.status).sort()).toEqual([204, 412]);
  expect(await auditCount()).toBe(before + 1);
  expect(
    listResponseSchema(allotmentRowSchema).parse((await read(token, c)).body).data,
  ).toHaveLength(1);
});

test('MANAGER is scoped to the room type property, HOUSEKEEPING may not read allotments', async () => {
  let token = await login(),
    c = await channel();
  expect((await read(token, c, otherTypeId)).status).toBe(403);
  token = await login('HOUSEKEEPING');
  expect((await read(token, c)).status).toBe(403);
});

test('an actual audit constraint failure rolls back all rows, scope version and durable response', async () => {
  const token = await login(),
    c = await channel();
  const initial = await read(token, c);
  expect(initial.status).toBe(200);
  const key = randomUUID();
  await rows(
    "ALTER TABLE audit_logs ADD CONSTRAINT h035_reject CHECK(action <> 'ALLOTMENT_UPDATED') NOT VALID",
  );
  try {
    expect((await write(token, c, initial.headers.etag, undefined, typeId, key)).status).toBe(500);
    const after = await read(token, c);
    expect(after.headers.etag).toBe(initial.headers.etag);
    expect(listResponseSchema(allotmentRowSchema).parse(after.body).data).toEqual([]);
    expect(await rows('SELECT id FROM idempotency_keys WHERE key=$1', [key])).toEqual([]);
  } finally {
    await rows('ALTER TABLE audit_logs DROP CONSTRAINT h035_reject');
  }
});

async function inventoryEvents() {
  return rows(
    "SELECT payload_json FROM outbox_events WHERE event_type='InventoryChanged' AND aggregate_type='ChannelAllotment' ORDER BY created_at,id",
  );
}
test('batch and same-key replay produce one versioned inventory outbox event in the command transaction', async () => {
  const token = await login(),
    c = await channel(),
    key = randomUUID();
  const initial = await read(token, c);
  const before = (await inventoryEvents()).length;
  const response = await write(token, c, initial.headers.etag, undefined, typeId, key);
  expect(response.status).toBe(204);
  const events = await inventoryEvents();
  expect(events).toHaveLength(before + 1);
  expect(
    z
      .object({
        schemaVersion: z.literal(1),
        propertyId: z.string(),
        channelId: z.string(),
        roomTypeId: z.string(),
        version: z.string(),
        dates: z.array(z.string()),
      })
      .parse(events.at(-1)!.payload_json),
  ).toEqual({
    schemaVersion: 1,
    propertyId,
    channelId: c,
    roomTypeId: typeId,
    version: z
      .string()
      .regex(/^"[1-9]\d*"$/)
      .parse(response.headers.etag)
      .slice(1, -1),
    dates,
  });
  expect((await write(token, c, initial.headers.etag, undefined, typeId, key)).status).toBe(204);
  expect(await inventoryEvents()).toHaveLength(before + 1);
});
test('actual outbox failure rolls back batch, audit, scope version and claim', async () => {
  const token = await login(),
    c = await channel(),
    key = randomUUID();
  const initial = await read(token, c),
    before = await auditCount();
  await rows(
    "ALTER TABLE outbox_events ADD CONSTRAINT h035_outbox_reject CHECK(aggregate_type <> 'ChannelAllotment') NOT VALID",
  );
  try {
    expect((await write(token, c, initial.headers.etag, undefined, typeId, key)).status).toBe(500);
    const after = await read(token, c);
    expect(after.headers.etag).toBe(initial.headers.etag);
    expect(listResponseSchema(allotmentRowSchema).parse(after.body).data).toEqual([]);
    expect(await auditCount()).toBe(before);
    expect(await rows('SELECT id FROM idempotency_keys WHERE key=$1', [key])).toEqual([]);
  } finally {
    await rows('ALTER TABLE outbox_events DROP CONSTRAINT h035_outbox_reject');
  }
});

test('a room type move while waiting for property lock retries and emits for its newly locked property', async () => {
  const token = await login('OWNER'),
    c = await channel();
  const initial = await read(token, c),
    before = (await inventoryEvents()).length;
  const mover = new pg.Client({ connectionString: databaseUrl });
  await mover.connect();
  let pending: Promise<{ status: number }> | undefined;
  try {
    await mover.query('BEGIN');
    await mover.query('SELECT id FROM properties WHERE id=$1::uuid FOR UPDATE', [propertyId]);
    pending = write(token, c, initial.headers.etag).then((response) => response);
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (Date.now() < deadline) {
      waiting =
        Number(
          (
            await rows(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM properties%FOR SHARE%'",
            )
          )[0]!.n,
        ) > 0;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await mover.query("UPDATE room_types SET property_id=$1,code='SUP' WHERE id=$2", [
      otherPropertyId,
      typeId,
    ]);
    await mover.query(
      "UPDATE rooms SET property_id=$1,code='H035-' || code WHERE room_type_id=$2",
      [otherPropertyId, typeId],
    );
    await mover.query('COMMIT');
    expect((await pending).status).toBe(204);
    const events = await inventoryEvents();
    expect(events).toHaveLength(before + 1);
    expect(z.object({ propertyId: z.string() }).parse(events.at(-1)!.payload_json).propertyId).toBe(
      otherPropertyId,
    );
  } finally {
    await mover.query('ROLLBACK');
    await pending;
    await rows("UPDATE room_types SET property_id=$1,code='STD' WHERE id=$2", [propertyId, typeId]);
    await rows(
      "UPDATE rooms SET property_id=$1,code=CASE WHEN code LIKE 'H035-%' THEN substring(code FROM 6) ELSE code END WHERE room_type_id=$2",
      [propertyId, typeId],
    );
    await mover.end();
  }
}, 15000);

test('quota update preserves closure metadata and mutable used cache; GET still derives live demand', async () => {
  const token = await login(),
    c = await channel();
  await allotment('OTA_BOOKING', 1, true);
  await rows('UPDATE channel_allotments SET used=99 WHERE channel_id=$1', [c]);
  const before = await rows(
    'SELECT is_closed,closed_reason,closed_at,used FROM channel_allotments WHERE channel_id=$1',
    [c],
  );
  const initial = await read(token, c);
  expect(
    (await write(token, c, initial.headers.etag, [{ date: dates[0]!, allotment: 2 }])).status,
  ).toBe(204);
  expect(
    await rows(
      'SELECT is_closed,closed_reason,closed_at,used FROM channel_allotments WHERE channel_id=$1',
      [c],
    ),
  ).toEqual(before);
  expect(listResponseSchema(allotmentRowSchema).parse((await read(token, c)).body).data).toEqual([
    { date: dates[0], allotment: 2, used: 0 },
  ]);
});
test('capacity excludes inactive rooms, while blocks do not shrink the ACTIVE quota ceiling', async () => {
  const token = await login(),
    c = await channel();
  await rows("UPDATE rooms SET status='INACTIVE' WHERE room_type_id=$1 AND code='R2'", [typeId]);
  let initial = await read(token, c);
  expect(
    (await write(token, c, initial.headers.etag, [{ date: dates[0]!, allotment: 2 }])).status,
  ).toBe(409);
  await rows("UPDATE rooms SET status='ACTIVE' WHERE room_type_id=$1", [typeId]);
  await rows(
    "INSERT INTO room_blocks(room_id,start_date,end_date,reason,created_by) SELECT id,$1::date,$2::date,'MAINTENANCE',$3 FROM rooms WHERE room_type_id=$4",
    [dates[0], '2026-11-04', userId, typeId],
  );
  initial = await read(token, c);
  expect(
    (await write(token, c, initial.headers.etag, [{ date: dates[0]!, allotment: 2 }])).status,
  ).toBe(204);
});
test('duplicate or invalid calendar items reject the entire batch before configuration/audit writes', async () => {
  const token = await login(),
    c = await channel(),
    initial = await read(token, c),
    before = await auditCount();
  expect(
    (
      await write(token, c, initial.headers.etag, [
        { date: dates[0]!, allotment: 1 },
        { date: dates[0]!, allotment: 2 },
      ])
    ).status,
  ).toBe(400);
  expect(
    (await write(token, c, initial.headers.etag, [{ date: '2026-02-30', allotment: 1 }])).status,
  ).toBe(400);
  expect((await read(token, c)).headers.etag).toBe(initial.headers.etag);
  expect(await auditCount()).toBe(before);
});
