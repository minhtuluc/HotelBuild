import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { outboxTraceExtension } from '../../src/infrastructure/prisma/outbox-trace.extension.js';
import {
  newTrace,
  runWithTrace,
  traceparentOf,
} from '../../src/infrastructure/tracing/trace-context.js';

/** Test khoá (HB-181 AC1) cần PostgreSQL thật; thiếu URL thì bỏ qua thay vì dựng CSDL giả. */
const databaseUrl = process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL;

describe.skipIf(databaseUrl === undefined)('traceparent trong payload outbox (HB-181 AC1)', () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl ?? '' }).$extends(
    outboxTraceExtension(),
  );
  const aggregateId = randomUUID();

  const createEvent = (operation: string) =>
    db.outbox_events.create({
      data: {
        event_type: 'InventoryChanged',
        aggregate_type: 'Booking',
        aggregate_id: aggregateId,
        payload_json: { operation },
      },
    });

  const payloadOf = async (id: string) => {
    const row = await db.outbox_events.findUniqueOrThrow({ where: { id } });
    return row.payload_json;
  };

  afterAll(async () => {
    await db.outbox_events.deleteMany({ where: { aggregate_id: aggregateId } });
    await db.$disconnect();
  });

  it('transaction nghiệp vụ ghi kèm traceparent của request', async () => {
    const trace = newTrace('hb181-outbox', true);
    const row = await runWithTrace(trace, () =>
      // Ghi qua `tx` của transaction để chứng minh extension áp **bên trong** transaction nghiệp vụ.
      db.$transaction((tx) =>
        tx.outbox_events.create({
          data: {
            event_type: 'InventoryChanged',
            aggregate_type: 'Booking',
            aggregate_id: aggregateId,
            payload_json: { operation: 'OUTBOX_TRACE' },
          },
        }),
      ),
    );
    expect(await payloadOf(row.id)).toMatchObject({
      operation: 'OUTBOX_TRACE',
      traceparent: traceparentOf(trace),
    });
  });

  it('tạo ngoài request (seed/CLI) giữ nguyên payload, không có khoá lạ', async () => {
    const row = await createEvent('NO_REQUEST');
    expect(await payloadOf(row.id)).toStrictEqual({ operation: 'NO_REQUEST' });
  });

  it('payload đã có traceparent thì không ghi đè', async () => {
    const trace = newTrace('hb181-existing', true);
    const row = await runWithTrace(trace, () =>
      db.outbox_events.create({
        data: {
          event_type: 'InventoryChanged',
          aggregate_type: 'Booking',
          aggregate_id: aggregateId,
          payload_json: { operation: 'EXISTING', traceparent: '00-giu-nguyen' },
        },
      }),
    );
    expect(await payloadOf(row.id)).toMatchObject({
      operation: 'EXISTING',
      traceparent: '00-giu-nguyen',
    });
  });
});
