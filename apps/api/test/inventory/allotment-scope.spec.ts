import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { allotmentFixture } from './allotment-fixture.js';
import {
  allotmentETag,
  lockAllotmentScope,
  readAllotmentConfiguration,
} from '../../src/modules/inv/allotments/scope.js';

describe('HB035 transaction-bound scope helper on PostgreSQL16', () => {
  let f: Awaited<ReturnType<typeof allotmentFixture>>;
  let prisma: PrismaClient;
  let channel: string;
  const scope = () => ({ channelId: channel, roomTypeId: f.type });
  const read = () =>
    prisma.$transaction((tx) =>
      readAllotmentConfiguration(tx, scope(), '2030-02-01', '2030-02-01'),
    );
  beforeAll(async () => {
    f = await allotmentFixture();
    prisma = new PrismaClient({ datasources: { db: { url: f.url } } });
  }, 90000);
  beforeEach(async () => {
    await f.db.query('DELETE FROM channels WHERE id<>$1', [f.legacyChannel]);
    channel = await f.channel();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await f?.close();
  });

  it('reads an empty scope as1 without creating database rows', async () => {
    expect(await read()).toEqual({ version: 1n, items: [] });
    expect(
      await prisma.channel_allotment_scopes.findMany({ where: { channel_id: channel } }),
    ).toEqual([]);
  });

  it('returns configuration fields in date order and includes both boundary dates', async () => {
    await prisma.$transaction(async (tx) => {
      await lockAllotmentScope(tx, scope(), 1n);
      await tx.channel_allotments.createMany({
        data: [
          { channel_id: channel, room_type_id: f.type, date: new Date('2030-02-02'), allotment: 1 },
          { channel_id: channel, room_type_id: f.type, date: new Date('2030-02-01'), allotment: 2 },
        ],
      });
    });
    expect(await read()).toEqual({
      version: 3n,
      items: [
        { date: '2030-02-01', allotment: 2, isClosed: false, closedReason: null, closedAt: null },
      ],
    });
    const full = await prisma.$transaction((tx) =>
      readAllotmentConfiguration(tx, scope(), '2030-02-01', '2030-02-02'),
    );
    expect(full.items.map((item) => item.date)).toEqual(['2030-02-01', '2030-02-02']);
    expect(allotmentETag((await read()).version)).toBe('"3"');
  });

  it('rejects the old group token after a low-version row changes outside the read range', async () => {
    const legacyScope = { channelId: f.legacyChannel, roomTypeId: f.type };
    const before = await prisma.$transaction((tx) =>
      readAllotmentConfiguration(tx, legacyScope, '2030-01-01', '2030-01-01'),
    );
    expect(before.version).toBe(1n);
    await prisma.channel_allotments.updateMany({
      where: { channel_id: f.legacyChannel, date: new Date('2030-01-02') },
      data: { allotment: 2 },
    });
    await expect(
      prisma.$transaction((tx) => lockAllotmentScope(tx, legacyScope, 1n)),
    ).rejects.toMatchObject({ status: 412, code: 'E_GEN_VERSION_CONFLICT' });
    const after = await prisma.$transaction((tx) =>
      readAllotmentConfiguration(tx, legacyScope, '2030-01-01', '2030-01-01'),
    );
    expect(after.items).toEqual(before.items);
    expect(after.version).toBe(2n);
  });

  it('serializes two writers of an initially empty scope: one winner, one412, no loser row', async () => {
    let signalFirst: () => void = () => {
      throw new Error('Latch not initialized');
    };
    let signalSecond: () => void = () => {
      throw new Error('Latch not initialized');
    };
    const firstLocked = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      signalSecond = resolve;
    });
    const winner = prisma.$transaction(
      async (tx) => {
        await lockAllotmentScope(tx, scope(), 1n);
        signalFirst();
        await secondStarted;
        await tx.channel_allotments.create({
          data: {
            channel_id: channel,
            room_type_id: f.type,
            date: new Date('2030-02-01'),
            allotment: 1,
          },
        });
        return 'winner';
      },
      { timeout: 10000 },
    );
    const loser = (async () => {
      await firstLocked;
      return prisma.$transaction(
        async (tx) => {
          signalSecond();
          await lockAllotmentScope(tx, scope(), 1n);
          await tx.channel_allotments.create({
            data: {
              channel_id: channel,
              room_type_id: f.type,
              date: new Date('2030-02-02'),
              allotment: 2,
            },
          });
        },
        { timeout: 10000 },
      );
    })();
    const results = await Promise.allSettled([winner, loser]);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'winner' });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { status: 412, code: 'E_GEN_VERSION_CONFLICT' },
    });
    expect((await read()).version).toBe(2n);
    expect(
      await prisma.channel_allotments.findMany({
        where: { channel_id: channel },
        select: { date: true, allotment: true },
      }),
    ).toEqual([{ date: new Date('2030-02-01'), allotment: 1 }]);
  });

  it('rolls back an earlier day and the new scope when a later quota violates the existing guard', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await lockAllotmentScope(tx, scope(), 1n);
        for (const [date, allotment] of [
          ['2030-02-01', 1],
          ['2030-02-02', 3],
        ] as const) {
          await tx.channel_allotments.create({
            data: { channel_id: channel, room_type_id: f.type, date: new Date(date), allotment },
          });
        }
      }),
    ).rejects.toThrow('E_INV_ALLOTMENT_EXCEEDS_ROOMS');
    expect(await read()).toEqual({ version: 1n, items: [] });
    expect(
      await prisma.channel_allotment_scopes.findMany({ where: { channel_id: channel } }),
    ).toEqual([]);
  });

  it('holds a committed scope row lock until commit, then rejects the waiting stale writer', async () => {
    await prisma.channel_allotment_scopes.create({
      data: { channel_id: channel, room_type_id: f.type },
    });
    let release: () => void = () => {
      throw new Error('Release not initialized');
    };
    let ready: () => void = () => {
      throw new Error('Ready not initialized');
    };
    let secondReady: (pid: number) => void = () => {
      throw new Error('PID latch not initialized');
    };
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const secondPid = new Promise<number>((resolve) => {
      secondReady = resolve;
    });
    const first = prisma.$transaction(
      async (tx) => {
        await lockAllotmentScope(tx, scope(), 1n);
        ready();
        await hold;
        await tx.channel_allotments.create({
          data: {
            channel_id: channel,
            room_type_id: f.type,
            date: new Date('2030-02-01'),
            allotment: 1,
          },
        });
      },
      { timeout: 10000 },
    );
    await locked;
    const second = prisma.$transaction(
      async (tx) => {
        const pid = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        secondReady(pid[0]!.pid);
        await lockAllotmentScope(tx, scope(), 1n);
        throw new Error('Stale writer was admitted');
      },
      { timeout: 10000 },
    );
    const settled = Promise.allSettled([first, second]);
    try {
      const pid = await secondPid;
      let blocked: { waiting: boolean; query: string } | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (
          await f.db.query<{ waiting: boolean; query: string }>(
            'SELECT cardinality(pg_blocking_pids(pid))>0 AS waiting,query FROM pg_stat_activity WHERE pid=$1',
            [pid],
          )
        ).rows[0];
        if (blocked?.waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked?.waiting).toBe(true);
      expect(blocked?.query).toContain('FOR UPDATE');
    } finally {
      release();
      await settled;
    }
    expect(await settled).toMatchObject([
      { status: 'fulfilled' },
      { status: 'rejected', reason: { status: 412 } },
    ]);
    expect((await read()).version).toBe(2n);
  }, 15000);

  it('keeps each version and configuration coherent during concurrent committed edits', async () => {
    await prisma.channel_allotments.create({
      data: {
        channel_id: channel,
        room_type_id: f.type,
        date: new Date('2030-02-01'),
        allotment: 1,
      },
    });
    await Promise.all([
      (async () => {
        for (let i = 0; i < 30; i++) {
          await prisma.channel_allotments.updateMany({
            where: { channel_id: channel },
            data: { allotment: i % 2 === 0 ? 2 : 1 },
          });
        }
      })(),
      (async () => {
        for (let i = 0; i < 60; i++) {
          const snapshot = await read();
          expect(snapshot.items).toHaveLength(1);
          expect(snapshot.items[0]!.allotment).toBe(snapshot.version % 2n === 0n ? 1 : 2);
        }
      })(),
    ]);
  }, 15000);

  it('rejects a stale empty token without leaving a new persisted scope', async () => {
    await expect(
      prisma.$transaction((tx) => lockAllotmentScope(tx, scope(), 2n)),
    ).rejects.toMatchObject({ status: 412 });
    expect(
      await prisma.channel_allotment_scopes.findMany({ where: { channel_id: channel } }),
    ).toEqual([]);
  });

  it('reads rows and version from one SQL statement without a read lock', async () => {
    const queries: string[] = [];
    const traced = new PrismaClient({
      datasources: { db: { url: f.url } },
      log: [{ emit: 'event', level: 'query' }],
    });
    traced.$on('query', (event) => {
      queries.push(event.query);
    });
    try {
      await traced.$transaction((tx) =>
        readAllotmentConfiguration(tx, scope(), '2030-02-01', '2030-02-01'),
      );
      const selects = queries.filter((query) => query.trim().startsWith('SELECT'));
      expect(selects).toHaveLength(1);
      expect(selects[0]).toContain('channel_allotment_scopes');
      expect(selects[0]).toContain('channel_allotments');
      expect(selects[0]).not.toMatch(/FOR\s+(UPDATE|SHARE)/i);
      expect(queries.join(' ')).not.toMatch(/INSERT|UPDATE|DELETE/);
    } finally {
      await traced.$disconnect();
    }
  });
});
