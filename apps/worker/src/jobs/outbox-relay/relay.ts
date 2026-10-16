import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { WorkerConfig } from '../../config/env.js';
import type { JobContext } from '../types.js';
import { outboxErrorCode, type OutboxConsumer } from './consumer.js';
import { envelopeOf, type OutboxEventRow } from './envelope.js';

/**
 * Relay outbox — vận chuyển **ít nhất một lần** với dấu vết bền theo consumer (ADR-017 quyết định 6–7).
 *
 * Luồng một lượt (`relayOnce`), mọi mốc thời gian lấy từ `context.clock`:
 * 1. **Đăng ký delivery**: quét `outbox_events` `PENDING`/`FAILED` đã tới `available_at`, tạo hàng
 *    `event_deliveries` cho từng consumer nhận loại sự kiện đó; khoá chính `(consumer, event_id)` cộng
 *    `ON CONFLICT DO NOTHING` nên phát lại **không** sinh bản ghi thứ hai.
 * 2. **Giành hàng (claim) bằng lease/CAS**: một câu `UPDATE` có điều kiện trên đúng hàng khoá chính,
 *    điền `lease_token` mới + `lease_expires_at`; hai relay chạy song song thì chỉ một câu trả về 1 hàng
 *    (relay kia 0 hàng ⇒ bỏ qua). Hàng `PROCESSING` quá hạn lease bị lượt sau **tiếp quản**.
 * 3. **Vận chuyển**: gọi `consumer.handle` **ngoài transaction** — không giữ khoá CSDL qua I/O.
 * 4. **Chốt kết quả theo token**: `COMPLETED`/thử lại/dead letter chỉ ghi được khi hàng còn
 *    `status = 'PROCESSING'` **và** `lease_token` đúng token của lượt này; relay cũ (token cũ) không ghi
 *    hoàn tất được. Lỗi ⇒ `attempts + 1`; chạm {@link OUTBOX_MAX_TRANSPORT_ATTEMPTS} thì `DEAD_LETTER`
 *    (BR-CHAN-07), ngược lại `PENDING` với `lease_expires_at` = mốc thử lại (backoff luỹ thừa có trần).
 * 5. **Chốt sự kiện**: `outbox_events` chuyển `PUBLISHED` **chỉ khi mọi delivery đã `COMPLETED`**, hoặc
 *    `DEAD_LETTER` khi mọi delivery đã dừng mà còn hàng chết. `PUBLISHED` là mốc **vận chuyển**, không
 *    phải completion của consumer; reconciler vì thế không bao giờ suy ra completed từ dấu này.
 *
 * Không thêm enum/cột mới: `outbox_events` không có `PROCESSING`, lease nằm hoàn toàn ở `event_deliveries`
 * (`lease_token`, `lease_expires_at`) — đúng ghi chú thiết kế của HB-130.
 *
 * Redis/BullMQ chỉ là nhịp chạy: mọi trạng thái công việc nằm ở PostgreSQL nên mất job trên Redis không
 * mất sự kiện; lượt sau quét lại từ CSDL là đủ (AC6).
 */
export const OUTBOX_QUEUE = 'q.outbox-relay';

/** Trần số lượt vận chuyển trước dead letter — BR-CHAN-07 (khác ngưỡng 3 lỗi liên tiếp của sync). */
export const OUTBOX_MAX_TRANSPORT_ATTEMPTS = 5;

/** Lý do ghi vào `outbox_events.last_error` khi mọi consumer đã dừng vì cạn lượt (không PII). */
export const OUTBOX_DEAD_LETTER_REASON = 'OUTBOX_TRANSPORT_EXHAUSTED';

export interface RelayOptions {
  /** Số sự kiện/delivery xử lý mỗi lượt. */
  readonly batchSize: number;
  /** Thời gian giữ lease một lượt vận chuyển; hết hạn thì lượt khác tiếp quản. */
  readonly leaseSeconds: number;
  /** Backoff cơ sở (giây) cho lần thử lại thứ nhất. */
  readonly retryBaseSeconds: number;
  /** Trần backoff (giây). */
  readonly retryMaxSeconds: number;
  /** Số lượt vận chuyển thất bại trước khi vào dead letter. */
  readonly maxAttempts: number;
}

export const DEFAULT_RELAY_OPTIONS: RelayOptions = {
  batchSize: 50,
  leaseSeconds: 30,
  retryBaseSeconds: 30,
  retryMaxSeconds: 900,
  maxAttempts: OUTBOX_MAX_TRANSPORT_ATTEMPTS,
};

/** Cấu hình vận hành đi từ `WorkerConfig` (nơi duy nhất đọc `process.env`); trần lượt vẫn là hằng BR. */
export function relayOptionsFromConfig(config: WorkerConfig): RelayOptions {
  return {
    batchSize: config.OUTBOX_RELAY_BATCH_SIZE,
    leaseSeconds: config.OUTBOX_RELAY_LEASE_SECONDS,
    retryBaseSeconds: config.OUTBOX_RELAY_RETRY_BASE_SECONDS,
    retryMaxSeconds: config.OUTBOX_RELAY_RETRY_MAX_SECONDS,
    maxAttempts: OUTBOX_MAX_TRANSPORT_ATTEMPTS,
  };
}

/** Backoff luỹ thừa có trần (giây): lượt 1 = `retryBaseSeconds`, lượt 2 = 2×, … */
export function retryDelaySeconds(attempt: number, options: RelayOptions): number {
  const exponential = options.retryBaseSeconds * 2 ** Math.max(attempt - 1, 0);
  return Math.min(exponential, options.retryMaxSeconds);
}

/** Kết quả một lượt relay — chỉ số đếm, không mang payload (NFR-SEC-04). */
export interface RelayReport {
  registered: number;
  unrouted: number;
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  stale: number;
  published: number;
  eventsDeadLettered: number;
}

interface CandidateRow {
  readonly id: string;
  readonly event_type: string;
}

/** `event_id` được đặt bí danh `id` để dùng lại thẳng được với {@link envelopeOf}. */
interface ClaimableRow extends OutboxEventRow {
  readonly consumer: string;
  readonly attempts: number;
}

/**
 * Bước 1 — tạo delivery còn thiếu cho các sự kiện đã commit. `skipDuplicates` dựa trên khoá chính
 * `(consumer, event_id)` nên gọi lại bao nhiêu lần cũng không nhân bản. Sự kiện không consumer nào nhận
 * được **đếm riêng** (`unrouted`) và để nguyên `PENDING`: relay không tự nhận đã vận chuyển hộ ai.
 */
async function registerDeliveries(
  db: PrismaClient,
  consumers: readonly OutboxConsumer[],
  options: RelayOptions,
  now: Date,
): Promise<{ registered: number; unrouted: number }> {
  const events = await db.$queryRaw<CandidateRow[]>`
    SELECT id, event_type FROM outbox_events
     WHERE status IN ('PENDING','FAILED') AND available_at <= ${now}
     ORDER BY available_at, created_at, id
     LIMIT ${options.batchSize}::int`;
  const rows: { event_id: string; consumer: string }[] = [];
  let unrouted = 0;
  for (const event of events) {
    const matching = consumers.filter((consumer) => consumer.accepts(event.event_type));
    if (matching.length === 0) {
      unrouted += 1;
      continue;
    }
    for (const consumer of matching) rows.push({ event_id: event.id, consumer: consumer.name });
  }
  if (rows.length === 0) return { registered: 0, unrouted };
  const created = await db.event_deliveries.createMany({ data: rows, skipDuplicates: true });
  return { registered: created.count, unrouted };
}

/**
 * Bước 2a — hàng có thể giành: `PENDING` đã tới mốc thử lại (`lease_expires_at` là "không thử trước mốc
 * này" khi hàng đang chờ) hoặc `PROCESSING` đã hết lease. `COMPLETED`/`DEAD_LETTER` không bao giờ được
 * chọn lại — đây là điều kiện "phát lại không tạo tác dụng thứ hai" ở tầng relay.
 */
async function claimableDeliveries(
  db: PrismaClient,
  options: RelayOptions,
  now: Date,
): Promise<ClaimableRow[]> {
  return db.$queryRaw<ClaimableRow[]>`
    SELECT d.event_id AS id, d.consumer, d.attempts, e.event_type, e.aggregate_type, e.aggregate_id,
           e.channel_id, e.payload_json, e.created_at
      FROM event_deliveries d
      JOIN outbox_events e ON e.id = d.event_id
     WHERE (d.status = 'PENDING' AND (d.lease_expires_at IS NULL OR d.lease_expires_at <= ${now}))
        OR (d.status = 'PROCESSING' AND d.lease_expires_at <= ${now})
     ORDER BY e.created_at, d.event_id, d.consumer
     LIMIT ${options.batchSize}::int`;
}

/**
 * Bước 2b — giành hàng bằng CAS trong **một** câu lệnh: điều kiện nằm trong `WHERE` nên PostgreSQL tự
 * tuần tự hoá hai relay cùng nhắm một hàng; relay thua nhận 0 hàng và bỏ qua lượt này. Token mới sinh
 * mỗi lần giành, nhờ vậy chủ cũ không thể chốt kết quả sau khi bị tiếp quản.
 */
export async function claimDelivery(
  db: PrismaClient,
  consumer: string,
  eventId: string,
  token: string,
  now: Date,
  leaseSeconds: number,
): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  const claimed = await db.$executeRaw`
    UPDATE event_deliveries
       SET status = 'PROCESSING', lease_token = ${token}::uuid, lease_expires_at = ${expiresAt},
           updated_at = ${now}
     WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid
       AND ((status = 'PENDING' AND (lease_expires_at IS NULL OR lease_expires_at <= ${now}))
            OR (status = 'PROCESSING' AND lease_expires_at <= ${now}))`;
  return claimed === 1;
}

/**
 * Bước 4a — completion bền của consumer, chỉ ghi khi token còn đúng chủ hàng. Trả `false` khi hàng đã bị
 * tiếp quản: lượt này **không** được coi là đã xong (dấu vết nằm ở lượt đang giữ lease).
 */
export async function completeDelivery(
  db: PrismaClient,
  consumer: string,
  eventId: string,
  token: string,
  now: Date,
): Promise<boolean> {
  const updated = await db.$executeRaw`
    UPDATE event_deliveries
       SET status = 'COMPLETED', completed_at = ${now}, attempts = attempts + 1,
           lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ${now}
     WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid
       AND status = 'PROCESSING' AND lease_token = ${token}::uuid`;
  return updated === 1;
}

/**
 * Bước 4b — ghi thất bại: tăng `attempts`, đặt mốc thử lại theo backoff, hoặc `DEAD_LETTER` khi chạm trần.
 * `last_error` chỉ nhận mã đã che từ {@link outboxErrorCode}. Trả `null` khi token đã cũ.
 */
export async function failDelivery(
  db: PrismaClient,
  consumer: string,
  eventId: string,
  token: string,
  now: Date,
  attempt: number,
  errorCode: string,
  options: RelayOptions,
): Promise<'RETRY' | 'DEAD_LETTER' | null> {
  const exhausted = attempt >= options.maxAttempts;
  const retryAt = exhausted
    ? null
    : new Date(now.getTime() + retryDelaySeconds(attempt, options) * 1000);
  const updated = await db.$executeRaw`
    UPDATE event_deliveries
       SET status = ${exhausted ? 'DEAD_LETTER' : 'PENDING'}, attempts = ${attempt}::int,
           last_error = ${errorCode}, lease_token = NULL, lease_expires_at = ${retryAt},
           updated_at = ${now}
     WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid
       AND status = 'PROCESSING' AND lease_token = ${token}::uuid`;
  if (updated !== 1) return null;
  return exhausted ? 'DEAD_LETTER' : 'RETRY';
}

/**
 * Bước 5 — chốt `outbox_events` từ trạng thái delivery (đối soát được, chạy lại vô hại). Dead letter xét
 * trước: sự kiện còn consumer chết thì không được mang dấu `PUBLISHED`. Payload giữ nguyên ở cả hai nhánh.
 */
async function finishEvents(
  db: PrismaClient,
  now: Date,
): Promise<{ published: number; eventsDeadLettered: number }> {
  const eventsDeadLettered = await db.$executeRaw`
    UPDATE outbox_events e
       SET status = 'DEAD_LETTER', processed_at = ${now}, last_error = ${OUTBOX_DEAD_LETTER_REASON},
           attempts = LEAST(32767, COALESCE(
             (SELECT MAX(d.attempts) FROM event_deliveries d WHERE d.event_id = e.id), e.attempts))::smallint,
           updated_at = ${now}
     WHERE e.status IN ('PENDING','FAILED')
       AND EXISTS (SELECT 1 FROM event_deliveries d
                    WHERE d.event_id = e.id AND d.status = 'DEAD_LETTER')
       AND NOT EXISTS (SELECT 1 FROM event_deliveries d
                        WHERE d.event_id = e.id AND d.status IN ('PENDING','PROCESSING'))`;
  const published = await db.$executeRaw`
    UPDATE outbox_events e
       SET status = 'PUBLISHED', processed_at = ${now}, updated_at = ${now}
     WHERE e.status IN ('PENDING','FAILED')
       AND EXISTS (SELECT 1 FROM event_deliveries d
                    WHERE d.event_id = e.id AND d.status = 'COMPLETED')
       AND NOT EXISTS (SELECT 1 FROM event_deliveries d
                        WHERE d.event_id = e.id AND d.status <> 'COMPLETED')`;
  return { published, eventsDeadLettered };
}

const EMPTY_REPORT: RelayReport = {
  registered: 0,
  unrouted: 0,
  claimed: 0,
  completed: 0,
  retried: 0,
  deadLettered: 0,
  stale: 0,
  published: 0,
  eventsDeadLettered: 0,
};

/**
 * Một lượt relay trọn vẹn. Lỗi của **từng** consumer chỉ tác động hàng delivery của nó; lỗi hạ tầng
 * (CSDL) ném ra ngoài để lượt chạy sau thử lại. Không có consumer nào đăng ký ⇒ thoát sớm, **không** đánh
 * dấu gì: thà để sự kiện chờ còn hơn tuyên bố đã vận chuyển khi chưa ai nhận.
 */
export async function relayOnce(
  context: JobContext,
  consumers: readonly OutboxConsumer[],
  options: RelayOptions = DEFAULT_RELAY_OPTIONS,
): Promise<RelayReport> {
  if (consumers.length === 0) {
    context.log({
      queue: OUTBOX_QUEUE,
      msg: 'relay: chưa có consumer nào đăng ký — giữ nguyên outbox (không đánh dấu vận chuyển)',
    });
    return EMPTY_REPORT;
  }
  const now = context.clock.now();
  const { registered, unrouted } = await registerDeliveries(context.db, consumers, options, now);
  const mutable: RelayReport = { ...EMPTY_REPORT, registered, unrouted };
  for (const row of await claimableDeliveries(context.db, options, now)) {
    const consumer = consumers.find((candidate) => candidate.name === row.consumer);
    if (consumer === undefined) {
      // Delivery còn lại của consumer đã bị gỡ khỏi worker: để nguyên cho vận hành xử lý, không tính là lỗi.
      mutable.unrouted += 1;
      continue;
    }
    const token = randomUUID();
    const claimed = await claimDelivery(
      context.db,
      row.consumer,
      row.id,
      token,
      now,
      options.leaseSeconds,
    );
    if (!claimed) continue;
    mutable.claimed += 1;
    try {
      await consumer.handle(envelopeOf(row), context);
    } catch (error) {
      const attempt = row.attempts + 1;
      const errorCode = outboxErrorCode(error);
      const outcome = await failDelivery(
        context.db,
        row.consumer,
        row.id,
        token,
        now,
        attempt,
        errorCode,
        options,
      );
      if (outcome === null) mutable.stale += 1;
      else if (outcome === 'DEAD_LETTER') {
        mutable.deadLettered += 1;
        context.log({
          queue: OUTBOX_QUEUE,
          msg: `relay: consumer ${row.consumer} cạn ${options.maxAttempts} lượt vận chuyển (${errorCode}) — dead letter`,
        });
      } else {
        mutable.retried += 1;
        context.log({
          queue: OUTBOX_QUEUE,
          msg: `relay: consumer ${row.consumer} lỗi lượt ${attempt}/${options.maxAttempts} (${errorCode}) — hẹn thử lại`,
        });
      }
      continue;
    }
    if (await completeDelivery(context.db, row.consumer, row.id, token, now))
      mutable.completed += 1;
    else mutable.stale += 1;
  }
  const finished = await finishEvents(context.db, now);
  mutable.published += finished.published;
  mutable.eventsDeadLettered += finished.eventsDeadLettered;
  return mutable;
}
