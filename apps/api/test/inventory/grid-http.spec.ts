import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { z } from 'zod';
import { expect, test } from 'vitest';
import { inventoryGridSchema } from '@pinehill/contracts';
import { seedReferenceData } from '../../prisma/seed/index.js';
import { databaseUrl } from '../idempotency/database.js';
import { http, login } from '../room-blocks/http-fixture.js';
import {
  rows,
  propertyId,
  otherPropertyId,
  typeId,
  roomId,
  otherTypeId,
  booking,
  block,
  allotment,
} from '../room-blocks/inventory-seed.js';

function grid(token: string, extra: Record<string, string> = {}) {
  return http()
    .get('/api/v1/inventory/grid')
    .set('Authorization', `Bearer ${token}`)
    .query({ propertyId, roomTypeId: typeId, from: '2026-11-01', to: '2026-11-03', ...extra });
}

test('grid publishes the database decision timestamp for the daily board, not browser time', async () => {
  const token = await login();
  const before = Number(
    (
      await rows('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS instant')
    )[0]!.instant,
  );
  const response = await grid(token);
  expect(response.status).toBe(200);
  const after = Number(
    (
      await rows('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS instant')
    )[0]!.instant,
  );
  const timestamp = z.object({ capturedAt: z.string().datetime() }).parse(response.body).capturedAt;
  expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(timestamp)).toBeLessThanOrEqual(after);
});

test('grid matches three hand-computed nights, including block, live/expired holds and negative pool', async () => {
  const token = await login('RESERVATION_AGENT');
  await block(roomId, '2026-11-01', '2026-11-02');
  await booking();
  const now = new Date(String((await rows('SELECT clock_timestamp() AS now'))[0]!.now)).getTime();
  await booking({
    status: 'HELD',
    channel: 'OTA_BOOKING',
    deadline: new Date(now + 3600000),
    start: '2026-11-02',
  });
  await booking({ status: 'HELD', deadline: new Date(now - 3600000) });
  await booking({ start: '2026-11-03', oversold: true });
  const response = await grid(token, { channelCode: 'OTA_BOOKING' });
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(inventoryGridSchema.parse(response.body).cells).toEqual([
    {
      date: '2026-11-01',
      supply: 1,
      demand: 1,
      pool: 0,
      blocked: 1,
      published: 0,
      channelAvailable: 0,
    },
    {
      date: '2026-11-02',
      supply: 2,
      demand: 2,
      pool: 0,
      blocked: 0,
      published: 0,
      channelAvailable: 0,
    },
    {
      date: '2026-11-03',
      supply: 2,
      demand: 3,
      pool: -1,
      blocked: 0,
      published: 0,
      channelAvailable: 0,
    },
  ]);
});

test('a closed or inactive channel publishes zero without reducing the shared commercial pool', async () => {
  const token = await login();
  await allotment('OTA_BOOKING', 1, true);
  const closed = await grid(token, { channelCode: 'OTA_BOOKING' });
  expect(closed.status).toBe(200);
  expect(inventoryGridSchema.parse(closed.body).cells[0]).toMatchObject({
    pool: 2,
    published: 2,
    channelAvailable: 0,
  });
  expect(inventoryGridSchema.parse(closed.body).cells[1]).toMatchObject({ channelAvailable: 1 });
  await rows("UPDATE channels SET status='INACTIVE' WHERE code='OTA_BOOKING'");
  try {
    const response = await grid(token, { channelCode: 'OTA_BOOKING' });
    expect(response.status).toBe(200);
    expect(inventoryGridSchema.parse(response.body).cells[0]).toMatchObject({
      supply: 2,
      pool: 2,
      published: 2,
      channelAvailable: 0,
    });
  } finally {
    await rows("UPDATE channels SET status='ACTIVE' WHERE code='OTA_BOOKING'");
  }
});

test('unfiltered grid includes all property types; the compatible primary projection is explicit', async () => {
  const token = await login();
  const response = await http()
    .get('/api/v1/inventory/grid')
    .set('Authorization', `Bearer ${token}`)
    .query({ propertyId, from: '2026-11-01', to: '2026-11-03' });
  expect(response.status).toBe(200);
  const all = z.object({ grids: z.array(inventoryGridSchema) }).parse(response.body).grids;
  expect(all).toHaveLength(2);
  expect(all.every((row) => row.propertyId === propertyId && row.cells.length === 3)).toBe(true);
  expect(inventoryGridSchema.parse(response.body)).toMatchObject({
    roomTypeId: all[0]!.roomTypeId,
    cells: all[0]!.cells,
  });
});

test('inclusive range is at most31 dates; invalid calendar dates and cross-property reads are rejected', async () => {
  const token = await login('RESERVATION_AGENT');
  expect((await grid(token, { from: '2026-12-01', to: '2026-12-31' })).status).toBe(200);
  expect((await grid(token, { from: '2026-12-01', to: '2027-01-01' })).status).toBe(400);
  expect((await grid(token, { from: '2026-02-30' })).status).toBe(400);
  expect((await grid(token, { propertyId: otherPropertyId })).status).toBe(403);
});

test('grid does not acquire row locks or change inventory configuration', async () => {
  const token = await login();
  const before = await rows(`SELECT
    (SELECT count(*) FROM channel_allotments) AS allotments,
    (SELECT count(*) FROM audit_logs WHERE action='ALLOTMENT_UPDATED') AS audit,
    (SELECT count(*) FROM idempotency_keys) AS keys`);
  const locker = new pg.Client({ connectionString: databaseUrl });
  await locker.connect();
  try {
    await locker.query('BEGIN');
    await locker.query('SELECT id FROM rooms WHERE id=$1::uuid FOR UPDATE', [roomId]);
    const response = await grid(token).timeout({ deadline: 2000 });
    expect(response.status).toBe(200);
    expect(inventoryGridSchema.parse(response.body).cells[0]).toMatchObject({ supply: 2 });
    expect(
      await rows(`SELECT
      (SELECT count(*) FROM channel_allotments) AS allotments,
      (SELECT count(*) FROM audit_logs WHERE action='ALLOTMENT_UPDATED') AS audit,
      (SELECT count(*) FROM idempotency_keys) AS keys`),
    ).toEqual(before);
  } finally {
    await locker.query('ROLLBACK');
    await locker.end();
  }
});

test('a type from another property and a property without types never produce a misleading grid', async () => {
  const token = await login('OWNER');
  expect((await grid(token, { roomTypeId: otherTypeId })).status).toBe(404);
  const empty = String(
    (
      await rows(
        "INSERT INTO properties(code,name,address,phone,latitude,longitude) VALUES('H035-EMPTY','Synthetic','Synthetic','Synthetic',0,0) RETURNING id",
      )
    )[0]!.id,
  );
  const response = await http()
    .get('/api/v1/inventory/grid')
    .set('Authorization', `Bearer ${token}`)
    .query({ propertyId: empty, from: '2026-11-01', to: '2026-11-03' });
  expect(response.status).toBe(404);
});

test('BR-RBAC-03 denies housekeeping operational inventory while reservation staff may read it', async () => {
  expect((await grid(await login('HOUSEKEEPING'))).status).toBe(403);
  expect((await grid(await login('RESERVATION_AGENT'))).status).toBe(200);
});

test('actual reference seed55 rooms/75 selling units over30 dates: p95≤800ms and gzip≤200KB', async () => {
  const token = await login('OWNER');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const summary = await seedReferenceData(client);
    expect(summary.rooms).toBe(55);
    expect(summary.sellingUnits).toBe(75);
  } finally {
    await client.end();
  }
  const properties = (
    await rows("SELECT id FROM properties WHERE code IN ('CS-01','CS-02','CS-03') ORDER BY code")
  ).map((row) => String(row.id));
  expect(properties).toHaveLength(3);
  const samples: number[] = [];
  let maxGzip = 0;
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    let gzip = 0;
    for (const property of properties) {
      const response = await http()
        .get('/api/v1/inventory/grid')
        .set('Authorization', `Bearer ${token}`)
        .query({ propertyId: property, from: '2026-12-01', to: '2026-12-30' });
      expect(response.status).toBe(200);
      const body: unknown = response.body;
      const all = z.object({ grids: z.array(inventoryGridSchema) }).parse(body).grids;
      expect(all).toHaveLength(5);
      expect(all.every((row) => row.cells.length === 30)).toBe(true);
      gzip += gzipSync(JSON.stringify(body)).byteLength;
    }
    if (i > 0) samples.push(performance.now() - start);
    maxGzip = Math.max(maxGzip, gzip);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  process.stdout.write(
    `HB035 reference seed:55rooms/75units×30dates,3properties,20samples p95=${p95.toFixed(2)}ms gzip=${maxGzip}bytes\n`,
  );
  expect(p95).toBeLessThanOrEqual(800);
  expect(maxGzip).toBeLessThanOrEqual(200 * 1024);
}, 60000);
