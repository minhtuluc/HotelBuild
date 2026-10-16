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
 * 1. **Chốt hàng cạn lượt**: delivery đã dùng hết {@link OUTBOX_MAX_TRANSPORT_ATTEMPTS} lượt mà chưa
 *    hoàn tất (kể cả hàng `PROCESSING` mồ côi vì tiến trình chết) chuyển `DEAD_LETTER` — nhờ vậy vòng
 *    "chết ngay sau khi giành hàng" cũng dừng sau đúng 5 lượt, không quay vô hạn.
 * 2. **Đăng ký delivery**: quét `outbox_events` `PENDING`/`FAILED` đã tới `available_at` **và thuộc loại
 *    sự kiện có consumer nhận** (`event_type = ANY(...)`), tạo hàng `event_deliveries` cho từng consumer
 *    nhận loại đó; khoá chính `(consumer, event_id)` cộng `ON CONFLICT DO NOTHING` nên phát lại **không**
 *    sinh bản ghi thứ hai. Lọc theo loại ngay trong truy vấn để sự kiện không-consumer-nhận không lấp đầy
 *    lô và **không làm đói** sự kiện có consumer (chúng vẫn ở `PENDING` và được nhặt ngay khi consumer mới
 *    đăng ký loại đó).
 * 3. **Giành hàng (claim) bằng lease/CAS**: một câu `UPDATE` có điều kiện trên đúng hàng khoá chính, điền
 *    `lease_token` mới + `lease_expires_at` **và tăng `attempts`** — lượt vận chuyển được ghi nhận ngay tại
 *    đây nên mọi kiểu chết (trước/sau khi gọi consumer) vẫn tiêu một lượt; `WHERE attempts < trần` chặn
 *    lượt thứ 6. Hai relay chạy song song thì chỉ một câu trả về hàng.
 * 4. **Vận chuyển**: gọi `consumer.handle` **ngoài transaction** — không giữ khoá CSDL qua I/O.
 * 5. **Chốt kết quả theo token**: `COMPLETED`/thử lại/dead letter chỉ ghi được khi hàng còn
 *    `status = 'PROCESSING'` **và** `lease_token` đúng token của lượt này; relay cũ (token cũ) không ghi
 *    hoàn tất được. `attempts` **chỉ** tăng ở bước 3 nên không đếm trùng lượt. Lỗi ⇒ chạm trần thì
 *    `DEAD_LETTER` (BR-CHAN-07), ngược lại `PENDING` với `lease_expires_at` = mốc thử lại (backoff luỹ
 *    thừa có trần).
 * 6. **Chốt sự kiện**: `outbox_events` chuyển `PUBLISHED` **chỉ khi mọi delivery đã `COMPLETED`**, hoặc
 *    `DEAD_LETTER` khi mọi delivery đã dừng mà còn hàng chết. `PUBLISHED` là mốc **vận chuyển**, không
 *    phải completion của consumer; reconciler vì thế không bao giờ suy ra completed từ dấu này.
 *
 * Hệ quả cần biết khi vận hành: `leaseSeconds` **phải** lớn hơn thời gian chạy dài nhất của consumer, nếu
 * không một lượt đang chạy có thể bị tiếp quản và bị tính thêm một lượt. Delivery của consumer đã bị gỡ
 * khỏi sổ đăng ký (đổi tên consumer) **không** bị xoá và **không** bị giành: chúng nằm lại `PENDING` cho vận
 * hành xử lý, không chặn consumer khác.
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

/** Lý do ghi vào `event_deliveries.last_error` khi hàng cạn lượt mà không lượt nào chốt được. */
export const OUTBOX_ATTEMPTS_EXHAUSTED_REASON = 'OUTBOX_TRANSPORT_ATTEMPTS_EXHAUSTED';

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
}

/** Loại sự kiện mà sổ đăng ký thực sự nhận — dùng cho bộ lọc SQL, không đoán từ tài liệu. */
function acceptedEventTypes(consumers: readonly OutboxConsumer[]): string[] {
  return [...new Set(consumers.flatMap((consumer) => consumer.eventTypes))];
}

/**
 * Bước 2 — tạo delivery còn thiếu cho các sự kiện đã commit **thuộc loại có consumer nhận**.
 * `skipDuplicates` dựa trên khoá chính `(consumer, event_id)` nên gọi lại bao nhiêu lần cũng không nhân
 * bản. Sự kiện không consumer nào nhận được **đếm riêng** (`unrouted`) và để nguyên `PENDING`: relay không
 * tự nhận đã vận chuyển hộ ai, đồng thời chúng không chen vào lô đăng ký nên không làm đói sự kiện có
 * consumer.
 */
async function registerDeliveries(
  db: PrismaClient,
  consumers: readonly OutboxConsumer[],
  options: RelayOptions,
  now: Date,
): Promise<{ registered: number; unrouted: number }> {
  const types = acceptedEventTypes(consumers);
  const events = await db.$queryRaw<CandidateRow[]>`
    SELECT id, event_type FROM outbox_events
     WHERE status IN ('PENDING','FAILED') AND available_at <= ${now}
       AND event_type = ANY(${types}::text[])
     ORDER BY available_at, created_at, id
     LIMIT ${options.batchSize}::int`;
  const rows: { event_id: string; consumer: string }[] = [];
  for (const event of events) {
    for (const consumer of consumers) {
      if (consumer.eventTypes.includes(event.event_type))
        rows.push({ event_id: event.id, consumer: consumer.name });
    }
  }
  const unrouted = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM outbox_events
     WHERE status IN ('PENDING','FAILED') AND available_at <= ${now}
       AND NOT (event_type = ANY(${types}::text[]))`;
  const created =
    rows.length === 0
      ? { count: 0 }
      : await db.event_deliveries.createMany({ data: rows, skipDuplicates: true });
  return { registered: created.count, unrouted: unrouted[0]?.n ?? 0 };
}

/**
 * Bước 1 — hàng đã tiêu hết lượt vận chuyển mà chưa chốt được gì (consumer lỗi ở lượt cuối, hoặc tiến
 * trình chết ngay sau khi giành hàng ở lượt cuối) thì chuyển `DEAD_LETTER` bền. Chỉ chạm hàng không còn
 * lease hiệu lực nên không cắt ngang một lượt đang chạy; `last_error` là mã của relay (không PII) còn
 * payload vẫn nằm ở `outbox_events`.
 */
async function deadLetterExhausted(
  db: PrismaClient,
  options: RelayOptions,
  now: Date,
): Promise<number> {
  return db.$executeRaw`
    UPDATE event_deliveries
       SET status = 'DEAD_LETTER', last_error = ${OUTBOX_ATTEMPTS_EXHAUSTED_REASON},
           lease_token = NULL, lease_expires_at = NULL, updated_at = ${now}
     WHERE attempts >= ${options.maxAttempts}::int
       AND status IN ('PENDING','PROCESSING')
       AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})`;
}

/**
 * Bước 3a — hàng có thể giành: của **consumer đã đăng ký**, còn lượt (`attempts < trần`), và `PENDING` đã
 * tới mốc thử lại (`lease_expires_at` là "không thử trước mốc này" khi hàng đang chờ) hoặc `PROCESSING` đã
 * hết lease. `COMPLETED`/`DEAD_LETTER` không bao giờ được chọn lại — đây là điều kiện "phát lại không tạo
 * tác dụng thứ hai" ở tầng relay. Lọc theo tên consumer ngay trong truy vấn để delivery mồ côi (consumer đã
 * bị gỡ) không lấp lô và không làm đói consumer khác.
 */
async function claimableDeliveries(
  db: PrismaClient,
  consumers: readonly OutboxConsumer[],
  options: RelayOptions,
  now: Date,
): Promise<ClaimableRow[]> {
  const names = consumers.map((consumer) => consumer.name);
  return db.$queryRaw<ClaimableRow[]>`
    SELECT d.event_id AS id, d.consumer, e.event_type, e.aggregate_type, e.aggregate_id,
           e.channel_id, e.payload_json, e.created_at
      FROM event_deliveries d
      JOIN outbox_events e ON e.id = d.event_id
     WHERE d.consumer = ANY(${names}::text[])
       AND d.attempts < ${options.maxAttempts}::int
       AND ((d.status = 'PENDING' AND (d.lease_expires_at IS NULL OR d.lease_expires_at <= ${now}))
            OR (d.status = 'PROCESSING' AND d.lease_expires_at <= ${now}))
     ORDER BY e.created_at, d.event_id, d.consumer
     LIMIT ${options.batchSize}::int`;
}

/** Kết quả giành hàng: token lease của lượt này và số lượt vận chuyển (đã tăng) để chốt kết quả. */
export interface DeliveryClaim {
  readonly token: string;
  readonly attempt: number;
}

/**
 * Bước 3b — giành hàng bằng CAS trong **một** câu lệnh: điều kiện nằm trong `WHERE` nên PostgreSQL tự
 * tuần tự hoá hai relay cùng nhắm một hàng; relay thua nhận `null` và bỏ qua lượt này. Token mới sinh mỗi
 * lần giành, nhờ vậy chủ cũ không thể chốt kết quả sau khi bị tiếp quản.
 *
 * `attempts = attempts + 1` nằm **duy nhất ở đây**: lượt vận chuyển được ghi nhận ngay khi giành, kể cả khi
 * tiến trình chết trước lúc gọi consumer — nếu không, chuỗi "giành rồi chết" sẽ không bao giờ chạm trần và
 * sự kiện quay vòng vô hạn.
 */
export async function claimDelivery(
  db: PrismaClient,
  consumer: string,
  eventId: string,
  now: Date,
  options: RelayOptions,
): Promise<DeliveryClaim | null> {
  const token = randomUUID();
  const expiresAt = new Date(now.getTime() + options.leaseSeconds * 1000);
  const claimed = await db.$queryRaw<{ attempts: number }[]>`
    UPDATE event_deliveries
       SET status = 'PROCESSING', lease_token = ${token}::uuid, lease_expires_at = ${expiresAt},
           attempts = attempts + 1, updated_at = ${now}
     WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid
       AND attempts < ${options.maxAttempts}::int
       AND ((status = 'PENDING' AND (lease_expires_at IS NULL OR lease_expires_at <= ${now}))
            OR (status = 'PROCESSING' AND lease_expires_at <= ${now}))
    RETURNING attempts`;
  const attempt = claimed[0]?.attempts;
  return attempt === undefined ? null : { token, attempt };
}

/**
 * Bước 5a — completion bền của consumer, chỉ ghi khi token còn đúng chủ hàng. Trả `false` khi hàng đã bị
 * tiếp quản: lượt này **không** được coi là đã xong (dấu vết nằm ở lượt đang giữ lease). `attempts` đã
 * được tính ở lúc giành hàng nên ở đây **không** cộng thêm (tránh đếm trùng).
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
       SET status = 'COMPLETED', completed_at = ${now},
           lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ${now}
     WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid
       AND status = 'PROCESSING' AND lease_token = ${token}::uuid`;
  return updated === 1;
}

/**
 * Bước 5b — ghi thất bại: đặt mốc thử lại theo backoff (tính từ `attempt` của lần giành này), hoặc
 * `DEAD_LETTER` khi đã chạm trần. `last_error` chỉ nhận mã đã che từ {@link outboxErrorCode}. `attempts`
 * **không** ghi lại ở đây (đã ghi lúc giành). Trả `null` khi token đã cũ.
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
       SET status = ${exhausted ? 'DEAD_LETTER' : 'PENDING'}, last_error = ${errorCode},
           lease_token = NULL, lease_expires_at = ${retryAt}, updated_at = ${now}
     WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid
       AND status = 'PROCESSING' AND lease_token = ${token}::uuid`;
  if (updated !== 1) return null;
  return exhausted ? 'DEAD_LETTER' : 'RETRY';
}

/**
 * Bước 6 — chốt `outbox_events` từ trạng thái delivery (đối soát được, chạy lại vô hại). Dead letter xét
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

/** Bộ đếm trong {@link RelayReport} mà một lượt vận chuyển tác động tới. */
type DeliveryCounter = 'completed' | 'retried' | 'deadLettered' | 'stale';

interface DeliveryRun {
  readonly counter: DeliveryCounter;
  /** `true` khi lượt này thực sự giành được hàng (kể cả khi chốt kết quả thất bại vì hàng đổi chủ). */
  readonly claimed: boolean;
}

/**
 * Bước 3–5 cho **một** hàng delivery: giành → gọi consumer ngoài transaction → chốt theo token. Tách khỏi
 * {@link relayOnce} để vòng quét giữ được độ phức tạp thấp và để mỗi hàng là một đơn vị đọc được.
 *
 * `stale` = lượt này không giành được hàng (chủ khác đang giữ) hoặc hàng đã đổi chủ trước khi chốt; nó
 * **không** phải lỗi của sự kiện.
 */
async function runDelivery(
  context: JobContext,
  consumer: OutboxConsumer,
  row: ClaimableRow,
  options: RelayOptions,
  now: Date,
): Promise<DeliveryRun> {
  const claim = await claimDelivery(context.db, row.consumer, row.id, now, options);
  if (claim === null) return { counter: 'stale', claimed: false };
  try {
    await consumer.handle(envelopeOf(row), context);
  } catch (error) {
    const errorCode = outboxErrorCode(error);
    const outcome = await failDelivery(
      context.db,
      row.consumer,
      row.id,
      claim.token,
      now,
      claim.attempt,
      errorCode,
      options,
    );
    if (outcome === null) return { counter: 'stale', claimed: true };
    context.log({
      queue: OUTBOX_QUEUE,
      msg:
        outcome === 'DEAD_LETTER'
          ? `relay: consumer ${row.consumer} cạn ${options.maxAttempts} lượt vận chuyển (${errorCode}) — dead letter`
          : `relay: consumer ${row.consumer} lỗi lượt ${claim.attempt}/${options.maxAttempts} (${errorCode}) — hẹn thử lại`,
    });
    return { counter: outcome === 'DEAD_LETTER' ? 'deadLettered' : 'retried', claimed: true };
  }
  const completed = await completeDelivery(context.db, row.consumer, row.id, claim.token, now);
  return { counter: completed ? 'completed' : 'stale', claimed: true };
}

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
  const exhausted = await deadLetterExhausted(context.db, options, now);
  const { registered, unrouted } = await registerDeliveries(context.db, consumers, options, now);
  const mutable: RelayReport = { ...EMPTY_REPORT, registered, unrouted, deadLettered: exhausted };
  if (exhausted > 0) {
    context.log({
      queue: OUTBOX_QUEUE,
      msg: `relay: ${exhausted} delivery cạn ${options.maxAttempts} lượt — dead letter`,
    });
  }
  for (const row of await claimableDeliveries(context.db, consumers, options, now)) {
    const consumer = consumers.find((candidate) => candidate.name === row.consumer);
    // Truy vấn đã lọc theo tên consumer đã đăng ký; nhánh này chỉ để an toàn kiểu.
    if (consumer === undefined) continue;
    const run = await runDelivery(context, consumer, row, options, now);
    if (run.claimed) mutable.claimed += 1;
    mutable[run.counter] += 1;
  }
  const finished = await finishEvents(context.db, now);
  mutable.published += finished.published;
  mutable.eventsDeadLettered += finished.eventsDeadLettered;
  return mutable;
}
