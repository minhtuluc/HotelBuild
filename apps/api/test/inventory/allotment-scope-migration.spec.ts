import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { allotmentFixture, root } from './allotment-fixture.js';
import { expectMigrationHistory } from '../migration/baseline-fixture.js';

describe('HB035 persisted configuration scope on real PostgreSQL16', () => {
  let f: Awaited<ReturnType<typeof allotmentFixture>>;
  beforeAll(async () => {
    f = await allotmentFixture();
  }, 90000);
  beforeEach(async () => {
    await f.db.query('DELETE FROM channels WHERE id<>$1', [f.legacyChannel]);
  });
  afterAll(async () => {
    await f?.close();
  });
  const version = async (channel: string) =>
    (
      await f.db.query<{ version: string }>(
        'SELECT version FROM channel_allotment_scopes WHERE channel_id=$1 AND room_type_id=$2',
        [channel, f.type],
      )
    ).rows;
  const insert = async (channel: string, date = '2030-02-01') =>
    f.db.query(
      'INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment) VALUES($1,$2,$3,1)',
      [channel, f.type, date],
    );

  it('backfills version1 while preserving populated child rows and timestamps', async () => {
    expect(await version(f.legacyChannel)).toEqual([{ version: '1' }]);
    expect((await f.db.query('SELECT * FROM channel_allotments ORDER BY date')).rows).toEqual(
      f.legacyRows,
    );
  });

  it('invalidates the group when MAX(row.version) stays unchanged', async () => {
    await f.db.query('BEGIN');
    try {
      await f.db.query(
        "UPDATE channel_allotments SET allotment=2 WHERE channel_id=$1 AND date='2030-01-02'",
        [f.legacyChannel],
      );
      expect(
        (
          await f.db.query('SELECT MAX(version) FROM channel_allotments WHERE channel_id=$1', [
            f.legacyChannel,
          ])
        ).rows,
      ).toEqual([{ max: '9' }]);
      expect(await version(f.legacyChannel)).toEqual([{ version: '2' }]);
    } finally {
      await f.db.query('ROLLBACK');
    }
  });

  it('covers all dates in a pair, separates channels, and ignores cached used-only updates', async () => {
    const channel = await f.channel();
    const other = await f.channel();
    await insert(channel);
    await insert(other);
    expect(await version(channel)).toEqual([{ version: '2' }]);
    await f.db.query('UPDATE channel_allotments SET used=1 WHERE channel_id=$1', [channel]);
    expect(await version(channel)).toEqual([{ version: '2' }]);
    await insert(channel, '2035-12-31');
    expect(await version(channel)).toEqual([{ version: '3' }]);
    expect(await version(other)).toEqual([{ version: '2' }]);
    await f.db.query(
      "UPDATE channel_allotments SET is_closed=true,closed_at='2030-01-01',closed_reason='Fixture' WHERE channel_id=$1",
      [channel],
    );
    expect(await version(channel)).toEqual([{ version: '5' }]);
  });

  it('keeps a tombstone counter after delete/reinsert to prevent version ABA', async () => {
    const channel = await f.channel();
    await insert(channel);
    await f.db.query('DELETE FROM channel_allotments WHERE channel_id=$1', [channel]);
    expect(await version(channel)).toEqual([{ version: '3' }]);
    await insert(channel);
    expect(await version(channel)).toEqual([{ version: '4' }]);
  });

  it('invalidates both scopes when a configuration row moves to another channel', async () => {
    const channel = await f.channel();
    const other = await f.channel();
    await insert(channel);
    await f.db.query('UPDATE channel_allotments SET channel_id=$2 WHERE channel_id=$1', [
      channel,
      other,
    ]);
    expect(await version(channel)).toEqual([{ version: '3' }]);
    expect(await version(other)).toEqual([{ version: '2' }]);
  });

  it('rolls back child changes, counters and creation of an empty scope together', async () => {
    const channel = await f.channel();
    await f.db.query('BEGIN');
    try {
      await insert(channel);
      expect(await version(channel)).toEqual([{ version: '2' }]);
    } finally {
      await f.db.query('ROLLBACK');
    }
    expect(await version(channel)).toEqual([]);
    expect(
      (await f.db.query('SELECT * FROM channel_allotments WHERE channel_id=$1', [channel])).rows,
    ).toEqual([]);
  });

  it('does not resurrect counters during a parent channel cascade', async () => {
    const channel = await f.channel();
    await insert(channel);
    await f.db.query('DELETE FROM channels WHERE id=$1', [channel]);
    expect(await version(channel)).toEqual([]);
  });

  it('separates room types, invalidates both when a row moves, and cleans a type cascade', async () => {
    const channel = await f.channel();
    const type = (
      await f.db.query<{ id: string }>(
        "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) SELECT property_id,'SUP','Fixture',2,650000,450000,1600000 FROM room_types WHERE id=$1 RETURNING id",
        [f.type],
      )
    ).rows[0]!.id;
    await f.db.query(
      "INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) SELECT property_id,id,'OTHER-R1','Fixture',2 FROM room_types WHERE id=$1",
      [type],
    );
    await insert(channel);
    await f.db.query('UPDATE channel_allotments SET room_type_id=$2 WHERE channel_id=$1', [
      channel,
      type,
    ]);
    expect(await version(channel)).toEqual([{ version: '3' }]);
    expect(
      (
        await f.db.query(
          'SELECT version FROM channel_allotment_scopes WHERE channel_id=$1 AND room_type_id=$2',
          [channel, type],
        )
      ).rows,
    ).toEqual([{ version: '2' }]);
    await f.db.query('DELETE FROM rooms WHERE room_type_id=$1', [type]);
    await f.db.query('DELETE FROM room_types WHERE id=$1', [type]);
    expect(
      (await f.db.query('SELECT * FROM channel_allotment_scopes WHERE room_type_id=$1', [type]))
        .rows,
    ).toEqual([]);
    expect(await version(channel)).toEqual([{ version: '3' }]);
  });

  it('rejects invalid stored versions, ignores forged updates, and applies once', async () => {
    for (const invalid of [0, -1, null]) {
      const channel = await f.channel();
      await expect(
        f.db.query(
          'INSERT INTO channel_allotment_scopes(channel_id,room_type_id,version) VALUES($1,$2,$3)',
          [channel, f.type, invalid],
        ),
      ).rejects.toMatchObject({ code: invalid === null ? '23502' : '23514' });
    }
    const prior = await version(f.legacyChannel);
    expect(prior).toHaveLength(1);
    await f.db.query('BEGIN');
    try {
      expect(
        (
          await f.db.query(
            'UPDATE channel_allotment_scopes SET version=999 WHERE channel_id=$1 RETURNING version',
            [f.legacyChannel],
          )
        ).rows,
      ).toEqual([{ version: String(BigInt(prior[0]!.version) + 1n) }]);
    } finally {
      await f.db.query('ROLLBACK');
    }
    const before = (
      await f.db.query('SELECT * FROM channel_allotment_scopes ORDER BY channel_id,room_type_id')
    ).rows;
    const history = (await f.db.query('SELECT * FROM _prisma_migrations ORDER BY migration_name'))
      .rows;
    f.migrate();
    expect(
      (await f.db.query('SELECT * FROM channel_allotment_scopes ORDER BY channel_id,room_type_id'))
        .rows,
    ).toEqual(before);
    expect(
      (await f.db.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows,
    ).toEqual(history);
    await expectMigrationHistory(f.db, root);
  }, 60000);
});
