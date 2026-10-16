import { PrismaClient } from '@prisma/client';
import { expect, test } from 'vitest';
import { loadWorkerConfig } from '../../src/config/env.js';
import { OUTBOX_CONSUMERS } from '../../src/jobs/outbox-relay/consumers.js';
import {
  OUTBOX_CONSUMER_UNKNOWN_ERROR,
  OutboxConsumerError,
  outboxErrorCode,
} from '../../src/jobs/outbox-relay/consumer.js';
import {
  OUTBOX_ENVELOPE_DEFAULT_SCHEMA_VERSION,
  envelopeOf,
  type OutboxEventRow,
} from '../../src/jobs/outbox-relay/envelope.js';
import {
  createOutboxRelayJob,
  outboxRelayJob,
} from '../../src/jobs/outbox-relay/outbox-relay.job.js';
import {
  DEFAULT_RELAY_OPTIONS,
  OUTBOX_MAX_TRANSPORT_ATTEMPTS,
  OUTBOX_QUEUE,
  relayOnce,
  relayOptionsFromConfig,
  retryDelaySeconds,
} from '../../src/jobs/outbox-relay/relay.js';
import type { JobContext } from '../../src/jobs/types.js';

/**
 * HB-130 — phần thuần của relay: dựng bao hình phòng thủ từ `payload_json` (producer không đổi), che mã
 * lỗi trước khi lưu, backoff/ngưỡng vận chuyển có cấu hình, và nhánh "chưa có consumer" không được chạm CSDL.
 */
const ENV = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

function eventRow(payload: unknown): OutboxEventRow {
  return {
    id: 'e1',
    event_type: 'InventoryChanged',
    aggregate_type: 'RoomType',
    aggregate_id: 'a1',
    channel_id: 'c1',
    payload_json: payload,
    created_at: new Date('2026-11-05T00:00:00Z'),
  };
}

/**
 * Ngữ cảnh trỏ tới một CSDL **không tồn tại** (cổng 1 từ chối ngay, Prisma chỉ kết nối khi có truy vấn):
 * nhánh thoát sớm mà lỡ chạm CSDL thì test đỏ vì lỗi kết nối, còn bình thường thì không truy vấn nào chạy.
 */
function contextWithoutDb(): { context: JobContext; logs: string[] } {
  const logs: string[] = [];
  const db = new PrismaClient({
    datasourceUrl: 'postgresql://khong-co:khong-co@127.0.0.1:1/khong-co',
  });
  return {
    logs,
    context: {
      db,
      config: loadWorkerConfig(ENV),
      clock: { now: () => new Date('2026-11-05T00:00:00Z') },
      log: ({ queue, msg }) => logs.push(`${queue}|${msg}`),
    },
  };
}

test('bao hình đọc đủ trường khi producer ghi đủ', () => {
  expect(
    envelopeOf(
      eventRow({ schemaVersion: 2, version: '7', correlationId: 'corr', causationId: 'caus' }),
    ),
  ).toMatchObject({
    eventId: 'e1',
    eventType: 'InventoryChanged',
    schemaVersion: 2,
    aggregateType: 'RoomType',
    aggregateId: 'a1',
    aggregateVersion: 7,
    occurredAt: new Date('2026-11-05T00:00:00Z'),
    correlationId: 'corr',
    causationId: 'caus',
    channelId: 'c1',
  });
  // `bigint` vượt số nguyên an toàn: trả null thay vì làm tròn.
  expect(envelopeOf(eventRow({ version: '9223372036854775807' })).aggregateVersion).toBeNull();
  expect(envelopeOf(eventRow({ aggregateVersion: 5 })).aggregateVersion).toBe(5);
});

test('bao hình không đoán giá trị thiếu hoặc không hợp lệ', () => {
  expect(envelopeOf(eventRow({}))).toMatchObject({
    schemaVersion: OUTBOX_ENVELOPE_DEFAULT_SCHEMA_VERSION,
    aggregateVersion: null,
    correlationId: null,
    causationId: null,
  });
  expect(
    envelopeOf(
      eventRow({ schemaVersion: 0, version: 'abc', correlationId: '   ', causationId: 42 }),
    ),
  ).toMatchObject({
    schemaVersion: 1,
    aggregateVersion: null,
    correlationId: null,
    causationId: null,
  });
  expect(envelopeOf(eventRow({ version: 3.5 })).aggregateVersion).toBeNull();
  // Payload không phải object (null/mảng) vẫn ra bao hình hợp lệ, giữ nguyên payload gốc.
  expect(envelopeOf(eventRow(null))).toMatchObject({
    schemaVersion: 1,
    aggregateVersion: null,
    payload: null,
  });
  expect(envelopeOf(eventRow([1, 2]))).toMatchObject({ schemaVersion: 1, aggregateVersion: null });
  expect(envelopeOf({ ...eventRow({}), channel_id: null }).channelId).toBeNull();
});

test('che mã lỗi trước khi ghi bền', () => {
  expect(outboxErrorCode(new OutboxConsumerError('NOTI_PROVIDER_UNAVAILABLE'))).toBe(
    'NOTI_PROVIDER_UNAVAILABLE',
  );
  expect(outboxErrorCode(new OutboxConsumerError('không phải mã ổn định'))).toBe(
    OUTBOX_CONSUMER_UNKNOWN_ERROR,
  );
  expect(outboxErrorCode(new OutboxConsumerError('X'.repeat(80)))).toBe(
    OUTBOX_CONSUMER_UNKNOWN_ERROR,
  );
  expect(outboxErrorCode(new Error('lỗi thô có PII 0905123456'))).toBe(
    OUTBOX_CONSUMER_UNKNOWN_ERROR,
  );
  expect(outboxErrorCode('chuỗi')).toBe(OUTBOX_CONSUMER_UNKNOWN_ERROR);
  expect(outboxErrorCode(undefined)).toBe(OUTBOX_CONSUMER_UNKNOWN_ERROR);
});

test('backoff luỹ thừa có trần, tính bằng giây', () => {
  const options = { ...DEFAULT_RELAY_OPTIONS, retryBaseSeconds: 30, retryMaxSeconds: 100 };
  expect(retryDelaySeconds(1, options)).toBe(30);
  expect(retryDelaySeconds(2, options)).toBe(60);
  expect(retryDelaySeconds(3, options)).toBe(100);
  expect(retryDelaySeconds(0, options)).toBe(30);
});

test('cấu hình vận hành lấy từ WorkerConfig, trần 5 lượt là hằng nghiệp vụ', () => {
  expect(OUTBOX_MAX_TRANSPORT_ATTEMPTS).toBe(5);
  expect(relayOptionsFromConfig(loadWorkerConfig(ENV))).toEqual({
    ...DEFAULT_RELAY_OPTIONS,
    maxAttempts: OUTBOX_MAX_TRANSPORT_ATTEMPTS,
  });
  expect(
    relayOptionsFromConfig(
      loadWorkerConfig({
        ...ENV,
        OUTBOX_RELAY_BATCH_SIZE: '7',
        OUTBOX_RELAY_LEASE_SECONDS: '45',
        OUTBOX_RELAY_RETRY_BASE_SECONDS: '5',
        OUTBOX_RELAY_RETRY_MAX_SECONDS: '60',
      }),
    ),
  ).toEqual({
    batchSize: 7,
    leaseSeconds: 45,
    retryBaseSeconds: 5,
    retryMaxSeconds: 60,
    maxAttempts: 5,
  });
});

test('chưa có consumer thì thoát sớm, không chạm CSDL và không đánh dấu vận chuyển', async () => {
  const { context, logs } = contextWithoutDb();
  expect(await relayOnce(context, [])).toEqual({
    registered: 0,
    unrouted: 0,
    claimed: 0,
    completed: 0,
    retried: 0,
    deadLettered: 0,
    stale: 0,
    published: 0,
    eventsDeadLettered: 0,
  });
  expect(logs.join('\n')).toContain(`${OUTBOX_QUEUE}|relay: chưa có consumer`);
});

test('handler hàng đợi chạy được với sổ consumer rỗng và log tổng hợp không payload', async () => {
  expect(OUTBOX_CONSUMERS).toHaveLength(0);
  expect(outboxRelayJob).toBeTypeOf('function');
  const { context, logs } = contextWithoutDb();
  await createOutboxRelayJob(OUTBOX_CONSUMERS)(undefined, context);
  const logged = logs.join('\n');
  expect(logged).toContain('relay: đăng ký 0');
  expect(logged).toContain(OUTBOX_QUEUE);
});
