import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { JobContext, JobHandler } from '../types.js';
import {
  notifyManager,
  recordAttempt,
  settleOperation,
  type AttemptOutcome,
  type NotifyPort,
} from './attempts.js';
import {
  CHANNEL_INVENTORY_EVENT,
  CHANNEL_SYNC_CONSUMER,
  CHANNEL_SYNC_FAILED,
  CHANNEL_SYNC_QUEUE,
  DELIVERY_MAX_ATTEMPTS,
  OTA_CHANNEL_CODES,
} from './contract.js';
import { loadChannelSyncSettings, type ChannelSyncSettings } from './settings.js';
import { buildSnapshot, pushSnapshot, type ChannelIdentity } from './snapshot.js';

const jobDataSchema = z.object({
  /** Khoá idempotent của lượt chạy (harness/relay đặt); vắng thì mỗi lượt quét là một khoá mới. */
  key: z.string().trim().min(1).max(200).optional(),
  channelId: z.uuid().optional(),
  version: z.number().int().min(0).optional(),
});

const operationPayloadSchema = z.object({
  channelId: z.uuid().optional(),
  version: z.number().int().min(0).optional(),
});

interface ClaimedDelivery {
  readonly eventId: string;
  readonly channelId: string;
  readonly version: number | null;
}

interface CandidateRow {
  readonly event_id: string;
  readonly channel_id: string;
  readonly aggregate_version: bigint | null;
}

export interface ChannelSyncJobDeps {
  readonly notify?: NotifyPort;
}

async function loadChannel(db: PrismaClient, channelId: string): Promise<ChannelIdentity | null> {
  const rows = await db.$queryRaw<ChannelIdentity[]>`
    SELECT id, code, version FROM channels WHERE id = ${channelId}::uuid`;
  return rows[0] ?? null;
}

/**
 * Bước đăng ký: sự kiện tồn/giá đã commit mà chưa có delivery cho consumer `channel-sync` được bổ sung
 * (`ON CONFLICT DO NOTHING`). Nhờ vậy mất job trên Redis hay một lượt chết giữa đường đều không làm mất
 * sự kiện — hàng `event_deliveries` là nguồn bền (ADR-017).
 */
async function registerDeliveries(db: PrismaClient): Promise<void> {
  await db.$executeRaw`
    INSERT INTO event_deliveries(event_id, consumer)
    SELECT e.id, ${CHANNEL_SYNC_CONSUMER}
      FROM outbox_events e
     WHERE e.event_type = ${CHANNEL_INVENTORY_EVENT}
       AND e.status IN ('PENDING','FAILED')
       AND e.available_at <= clock_timestamp()
       AND COALESCE(e.channel_id, (e.payload_json->>'channelId')::uuid) IS NOT NULL
    ON CONFLICT (consumer, event_id) DO NOTHING`;
}

/**
 * Bước giành hàng: lease/CAS trên `(consumer, event_id)` và tăng `attempts` **ngay tại đây** nên mọi kiểu
 * chết đều tiêu một lượt (cùng luật relay HB-130 nhưng cho consumer riêng của kênh).
 */
async function claimDeliveries(
  db: PrismaClient,
  token: string,
): Promise<readonly ClaimedDelivery[]> {
  const candidates = await db.$queryRaw<CandidateRow[]>`
    SELECT d.event_id,
           COALESCE(e.channel_id, (e.payload_json->>'channelId')::uuid) AS channel_id,
           CASE WHEN jsonb_typeof(e.payload_json->'aggregateVersion') = 'number'
                THEN (e.payload_json->>'aggregateVersion')::bigint END AS aggregate_version
      FROM event_deliveries d
      JOIN outbox_events e ON e.id = d.event_id
     WHERE d.consumer = ${CHANNEL_SYNC_CONSUMER}
       AND COALESCE(e.channel_id, (e.payload_json->>'channelId')::uuid) IS NOT NULL
       AND d.attempts < ${DELIVERY_MAX_ATTEMPTS}::int
       AND ((d.status = 'PENDING'
             AND (d.lease_expires_at IS NULL OR d.lease_expires_at <= clock_timestamp()))
         OR (d.status = 'PROCESSING' AND d.lease_expires_at <= clock_timestamp()))
     ORDER BY d.created_at, d.event_id
     LIMIT 50`;
  const claimed: ClaimedDelivery[] = [];
  for (const candidate of candidates) {
    const rows = await db.$queryRaw<{ event_id: string }[]>`
      UPDATE event_deliveries
         SET status = 'PROCESSING', lease_token = ${token}::uuid,
             lease_expires_at = clock_timestamp() + interval '30 seconds',
             attempts = attempts + 1, updated_at = clock_timestamp()
       WHERE event_id = ${candidate.event_id}::uuid
         AND consumer = ${CHANNEL_SYNC_CONSUMER}
         AND attempts < ${DELIVERY_MAX_ATTEMPTS}::int
         AND ((status = 'PENDING'
               AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()))
           OR (status = 'PROCESSING' AND lease_expires_at <= clock_timestamp()))
       RETURNING event_id`;
    if (rows.length === 0) continue;
    claimed.push({
      eventId: candidate.event_id,
      channelId: candidate.channel_id,
      version: candidate.aggregate_version === null ? null : Number(candidate.aggregate_version),
    });
  }
  return claimed;
}

/**
 * Chốt kết quả từng delivery: thành công ⇒ `COMPLETED`; thất bại ⇒ trả `PENDING` với backoff, hoặc
 * `DEAD_LETTER` khi đã cạn 5 lượt vận chuyển (BR-CHAN-07). `last_error` chỉ chứa mã đã che.
 */
async function settleDeliveries(
  db: PrismaClient,
  items: readonly ClaimedDelivery[],
  succeeded: boolean,
): Promise<void> {
  for (const item of items) {
    if (succeeded) {
      await db.$executeRaw`
        UPDATE event_deliveries
           SET status = 'COMPLETED', completed_at = clock_timestamp(),
               lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
         WHERE event_id = ${item.eventId}::uuid AND consumer = ${CHANNEL_SYNC_CONSUMER}`;
      await db.$executeRaw`
        UPDATE operations
           SET status = 'SUCCEEDED', finished_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE kind = 'CHANNEL_DELIVERY_RETRY' AND status = 'PENDING'
           AND payload_json->>'eventId' = ${item.eventId}`;
      continue;
    }
    await db.$executeRaw`
      UPDATE event_deliveries
         SET status = CASE WHEN attempts >= ${DELIVERY_MAX_ATTEMPTS}::int
                           THEN 'DEAD_LETTER' ELSE 'PENDING' END,
             lease_token = NULL,
             lease_expires_at = CASE WHEN attempts >= ${DELIVERY_MAX_ATTEMPTS}::int
                                     THEN NULL
                                     ELSE clock_timestamp()
                                          + interval '30 seconds' * LEAST(attempts, 5) END,
             last_error = ${CHANNEL_SYNC_FAILED}, updated_at = clock_timestamp()
       WHERE event_id = ${item.eventId}::uuid AND consumer = ${CHANNEL_SYNC_CONSUMER}`;
  }
}

/** Lệnh 202 của API để lại `operations` PENDING — lượt quét là nơi duy nhất thực thi và chốt trạng thái. */
async function pendingSyncOperations(
  db: PrismaClient,
): Promise<readonly { id: string; channelId: string; version: number | null }[]> {
  const rows = await db.$queryRaw<{ id: string; payload_json: unknown }[]>`
    SELECT id, payload_json FROM operations
     WHERE status = 'PENDING' AND kind = 'CHANNEL_SYNC'
     ORDER BY created_at
     LIMIT 20`;
  const operations: { id: string; channelId: string; version: number | null }[] = [];
  for (const row of rows) {
    const payload = operationPayloadSchema.safeParse(row.payload_json);
    if (!payload.success || payload.data.channelId === undefined) continue;
    operations.push({
      id: row.id,
      channelId: payload.data.channelId,
      version: payload.data.version ?? null,
    });
  }
  return operations;
}

/**
 * Kênh neo của nhịp quét rỗi: `DEGRADED` trước (cần bằng chứng phục hồi), rồi kênh có `last_sync_at` cũ
 * nhất; kênh chưa từng đồng bộ xếp sau vì ảnh của nó chỉ đổi khi có sự kiện outbox.
 */
async function anchorChannel(db: PrismaClient): Promise<ChannelIdentity | null> {
  const rows = await db.$queryRaw<ChannelIdentity[]>`
    SELECT id, code, version
      FROM channels
     WHERE status = 'ACTIVE' AND code = ANY(${OTA_CHANNEL_CODES}::text[])
     ORDER BY (sync_status = 'DEGRADED') DESC, last_sync_at ASC NULLS LAST, created_at, code
     LIMIT 1`;
  return rows[0] ?? null;
}

interface SyncResult {
  readonly succeeded: boolean;
  readonly outcome: AttemptOutcome;
}

/** Một lượt quét: giữ ngữ cảnh (job/CSDL/cấu hình) và đếm số lần đẩy ảnh để quyết định kiểm tra kênh neo. */
class SweepRunner {
  pushes = 0;
  deliveries = 0;
  /** Kết quả đã chốt của từng kênh trong lượt — mỗi kênh chỉ đẩy **một** ảnh và đếm **một** lượt. */
  private readonly outcomes = new Map<string, SyncResult>();

  constructor(
    readonly context: JobContext,
    readonly settings: ChannelSyncSettings,
    readonly today: string,
    readonly sweepKey: string,
    readonly notify: NotifyPort,
  ) {}

  private async syncChannel(
    channelId: string,
    version: number | null,
    attemptKey: string,
    operationId: string | null,
  ): Promise<SyncResult> {
    const channel = await loadChannel(this.context.db, channelId);
    if (channel === null) {
      this.context.log({
        queue: CHANNEL_SYNC_QUEUE,
        msg: 'bỏ qua lượt đồng bộ cho kênh không tồn tại',
        errorCode: 'CHANNEL_MISSING',
      });
      return { succeeded: false, outcome: { fresh: false, notificationId: null } };
    }
    const snapshot = await buildSnapshot(
      this.context.db,
      channel,
      version ?? Number(channel.version),
      this.today,
    );
    const succeeded =
      this.settings.simulatorBaseUrl !== null &&
      (await pushSnapshot(this.settings.simulatorBaseUrl, snapshot));
    const outcome = await recordAttempt(
      this.context,
      channel,
      attemptKey,
      succeeded,
      this.settings,
      operationId,
    );
    return { succeeded, outcome };
  }

  private async notifyIfDegraded(outcome: AttemptOutcome): Promise<void> {
    if (outcome.notificationId === null) return;
    try {
      await this.notify(this.context.config.REDIS_URL, outcome.notificationId);
    } catch {
      // Cảnh báo đã bền trong `notifications`; lỗi phát job không được làm hỏng lượt đồng bộ.
      this.context.log({
        queue: CHANNEL_SYNC_QUEUE,
        msg: 'không phát được job gửi cảnh báo kênh',
        errorCode: 'NOTIFICATION_ENQUEUE_FAILED',
      });
    }
  }

  /**
   * Khoá idempotent của **một kênh trong một lượt quét**: delivery và operation của cùng kênh dùng chung
   * khoá nên một lượt chỉ cộng counter đúng một lần, phát lại cùng lượt không cộng thêm.
   */
  private attemptKey(channelId: string): string {
    return `${channelId}:${this.sweepKey}`;
  }

  async pushChannel(
    channelId: string,
    version: number | null,
    operationId: string | null = null,
  ): Promise<boolean> {
    const cached = this.outcomes.get(channelId);
    if (cached !== undefined) {
      // Kênh đã được đẩy trong lượt này: chốt operation theo kết quả đó, không đẩy/gia tăng lần hai.
      if (operationId !== null)
        await settleOperation(this.context.db, operationId, cached.succeeded);
      return cached.succeeded;
    }
    this.pushes += 1;
    const result = await this.syncChannel(
      channelId,
      version,
      this.attemptKey(channelId),
      operationId,
    );
    this.outcomes.set(channelId, result);
    await this.notifyIfDegraded(result.outcome);
    return result.succeeded;
  }

  async pushOperation(
    operationId: string,
    channelId: string,
    version: number | null,
  ): Promise<void> {
    await this.pushChannel(channelId, version, operationId);
  }

  /** Delivery được gom theo kênh và đẩy **một ảnh mới nhất** (version lớn nhất), không cộng dồn delta. */
  async pushDeliveries(): Promise<void> {
    await registerDeliveries(this.context.db);
    const claimed = await claimDeliveries(this.context.db, randomUUID());
    this.deliveries = claimed.length;
    const groups = new Map<string, { version: number | null; items: ClaimedDelivery[] }>();
    for (const item of claimed) {
      const group: { version: number | null; items: ClaimedDelivery[] } = groups.get(
        item.channelId,
      ) ?? { version: null, items: [] };
      group.items.push(item);
      if (item.version !== null) group.version = Math.max(group.version ?? 0, item.version);
      groups.set(item.channelId, group);
    }
    for (const [channelId, group] of groups) {
      const succeeded = await this.pushChannel(channelId, group.version);
      await settleDeliveries(this.context.db, group.items, succeeded);
    }
  }

  async pushPendingOperations(): Promise<void> {
    for (const operation of await pendingSyncOperations(this.context.db))
      await this.pushOperation(operation.id, operation.channelId, operation.version);
  }

  /**
   * Lượt quét không có việc (không delivery/operation) vẫn đẩy **một kênh neo** — kênh OTA đang bật cần
   * đồng bộ nhất — để nhịp 5 phút giữ tín hiệu sức khoẻ adapter mà không phát lại toàn bộ ảnh không đổi.
   */
  async pushAnchor(): Promise<void> {
    if (this.pushes > 0) return;
    const channel = await anchorChannel(this.context.db);
    if (channel === null) return;
    await this.pushChannel(channel.id, null);
  }
}

/**
 * Handler thật của `q.channel-sync` (HB-131).
 *
 * Hàng đợi chỉ là **nhịp chạy**: payload không mang tồn/giá. Một lượt chạy (1) bổ sung delivery còn thiếu,
 * (2) giành delivery tới hạn và đẩy ảnh tồn mới nhất, (3) xử lý `operations` CHANNEL_SYNC do API để lại,
 * (4) lượt rỗi chỉ đẩy ảnh của **một** kênh neo làm phép thử sức khoẻ adapter. Mọi I/O mạng nằm **ngoài**
 * transaction; trạng thái kênh + sổ lượt + cảnh báo nằm trong một transaction. Mỗi kênh đẩy tối đa **một**
 * lần cho mỗi lượt với cùng khoá `attemptKey` nên counter không bị cộng đôi.
 */
export function createChannelSyncJob(deps: ChannelSyncJobDeps = {}): JobHandler {
  const notify = deps.notify ?? notifyManager;
  return async (raw, context) => {
    const parsed = jobDataSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new Error('CHANNEL_SYNC_PAYLOAD_INVALID');
    const job = parsed.data;
    const settings = await loadChannelSyncSettings(context.db);
    // Cửa sổ đẩy ảnh tồn tính theo UTC của tiến trình; ngày nghiệp vụ của API vẫn theo múi giờ vận hành.
    const today = context.clock.now().toISOString().slice(0, 10);
    const sweepKey = job.key ?? randomUUID();
    const runner = new SweepRunner(context, settings, today, sweepKey, notify);

    if (job.channelId !== undefined) {
      await runner.pushChannel(job.channelId, job.version ?? null);
    } else {
      await runner.pushDeliveries();
      await runner.pushPendingOperations();
      await runner.pushAnchor();
    }
    context.log({
      queue: CHANNEL_SYNC_QUEUE,
      msg: `channel-sync: ${runner.pushes} lượt đẩy ảnh tồn, ${runner.deliveries} delivery giành được`,
    });
  };
}

export const channelSyncJob: JobHandler = createChannelSyncJob();
