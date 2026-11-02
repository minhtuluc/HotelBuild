import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { outboxDeliveryStatusSchema } from '@pinehill/contracts';
import type {
  ChannelSyncStatusView,
  ListPage,
  OperationRef,
  OutboxDelivery,
} from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import {
  CHANNEL_SYNC_CONSUMER,
  channelOperationStatusUrl,
} from '../../../worker-runtime/channel-sync.js';
import { missing } from '../../sys/settings/validation.js';
import { ChannelSyncService } from '../sync/service.js';
import { scopeArray } from '../sync/scope-sql.js';
import { decodeDeliveryCursor, encodeDeliveryCursor, type DeliveryQuery } from './validation.js';

interface StatusRow {
  readonly sync_status: string;
  readonly consecutive_sync_failures: number;
  readonly last_sync_at: Date | null;
  readonly last_sync_error: string | null;
}

interface HistoryRow {
  readonly attempted_at: Date;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly error_code: string | null;
}

interface DeliveryRow {
  readonly event_id: string;
  readonly event_type: string;
  readonly consumer: string;
  readonly status: string;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly lease_expires_at: Date | null;
  readonly created_at: Date;
  readonly created_key: string;
  readonly completed_at: Date | null;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

const replayConflict = () =>
  new AppError(
    409,
    'E_CHAN_REPLAY_DETECTED',
    'Delivery đã hoàn tất; không gửi lại một lần giao đã xong.',
  );

const retryInProgress = () =>
  new AppError(409, 'E_SYS_REQUEST_IN_PROGRESS', 'Delivery đang được một lượt khác xử lý.');

/**
 * HB-131 / api.md §2.7 — đường đọc/retry cho SCR-40/41/42 (MANAGER/OWNER).
 *
 * Mọi phản hồi **che** payload, credentials và lỗi thô: chỉ mã lỗi ổn định, đếm lượt, mốc thời gian và
 * khoá `(eventId, consumerKey)` — đúng HB-120 AC11. Retry chỉ enqueue lại bằng cách đưa delivery về
 * `PENDING`: không gọi OTA trong transaction và không đánh `COMPLETED` trước khi adapter thực nhận ảnh.
 */
export class ChannelMonitoringService {
  constructor(
    readonly db: PrismaClient,
    readonly channels: ChannelSyncService,
    readonly audit: AuditWriter,
  ) {}

  async syncStatus(_actor: AuthorizedActor, channelId: string): Promise<ChannelSyncStatusView> {
    return this.db.$transaction(async (tx) => {
      await this.channels.loadChannel(tx, channelId);
      const rows = await tx.$queryRaw<StatusRow[]>(Prisma.sql`
        SELECT sync_status, consecutive_sync_failures, last_sync_at, last_sync_error
          FROM channels WHERE id = ${channelId}::uuid`);
      const row = rows[0];
      if (row === undefined) throw missing();
      const history = await tx.$queryRaw<HistoryRow[]>(Prisma.sql`
        SELECT attempted_at, outcome, error_code FROM channel_sync_attempts
         WHERE channel_id = ${channelId}::uuid
         ORDER BY attempted_at DESC, id DESC
         LIMIT 20`);
      const healthy = row.sync_status === 'OK' && row.consecutive_sync_failures === 0;
      return {
        channelId,
        syncStatus: row.sync_status === 'DEGRADED' ? 'DEGRADED' : 'OK',
        consecutiveFailures: Number(row.consecutive_sync_failures),
        lastSyncAt: iso(row.last_sync_at),
        // Chỉ lượt **xác minh thành công** mới là mốc phục hồi; lỗi gần nhất vẫn được giữ làm bằng chứng.
        lastSuccessAt: healthy ? iso(row.last_sync_at) : null,
        lastVerifiedAt: healthy ? iso(row.last_sync_at) : null,
        lastError: row.last_sync_error,
        history: history.map((entry) => ({
          at: entry.attempted_at.toISOString(),
          outcome: entry.outcome,
          error: entry.error_code,
        })),
      };
    });
  }

  async deliveries(
    _actor: AuthorizedActor,
    channelId: string,
    query: DeliveryQuery,
  ): Promise<ListPage<OutboxDelivery>> {
    return this.db.$transaction(async (tx) => {
      await this.channels.loadChannel(tx, channelId);
      const consumer = query.consumerKey ?? CHANNEL_SYNC_CONSUMER;
      const cursor = query.cursor === null ? null : decodeDeliveryCursor(query.cursor);
      const matching: Prisma.Sql[] = [
        Prisma.sql`e.channel_id = ${channelId}::uuid`,
        Prisma.sql`d.consumer = ${consumer}`,
      ];
      if (query.status !== null) matching.push(Prisma.sql`d.status = ${query.status}`);
      const base = Prisma.join(matching, ' AND ');
      const page =
        cursor === null
          ? base
          : Prisma.join(
              [
                Prisma.sql`(${base})`,
                Prisma.sql`(d.created_at, d.event_id) < (${cursor.createdAt}::timestamptz, ${cursor.eventId}::uuid)`,
              ],
              ' AND ',
            );
      const rows = await tx.$queryRaw<DeliveryRow[]>(Prisma.sql`
        SELECT d.event_id, e.event_type, d.consumer, d.status, d.attempts, d.last_error,
               d.lease_expires_at, d.created_at, d.completed_at,
               to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_key
          FROM event_deliveries d
          JOIN outbox_events e ON e.id = d.event_id
         WHERE ${page}
         ORDER BY d.created_at DESC, d.event_id DESC
         LIMIT ${query.limit + 1}`);
      const data = rows.slice(0, query.limit).map((row) => ({
        id: row.event_id,
        eventId: row.event_id,
        eventType: row.event_type,
        consumerKey: row.consumer,
        status: outboxDeliveryStatusSchema.parse(row.status),
        attempts: Number(row.attempts),
        lastError: row.last_error,
        nextAttemptAt: row.status === 'PENDING' ? iso(row.lease_expires_at) : null,
        createdAt: row.created_at.toISOString(),
        processedAt: iso(row.completed_at),
      }));
      const total = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n
          FROM event_deliveries d
          JOIN outbox_events e ON e.id = d.event_id
         WHERE ${base}`);
      const hasMore = rows.length > query.limit;
      const last = hasMore ? rows[query.limit - 1] : undefined;
      return {
        data,
        meta: {
          limit: query.limit,
          total: Number(total[0]?.n ?? 0),
          hasMore,
          nextCursor:
            hasMore && last !== undefined
              ? encodeDeliveryCursor({ createdAt: last.created_key, eventId: last.event_id })
              : null,
        },
      };
    });
  }

  async retry(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    channelId: string,
    deliveryId: string,
  ): Promise<OperationRef> {
    await this.channels.loadChannel(tx, channelId);
    const rows = await tx.$queryRaw<
      { event_id: string; consumer: string; status: string; lease_active: boolean }[]
    >(Prisma.sql`
      SELECT d.event_id, d.consumer, d.status,
             (d.lease_expires_at IS NOT NULL AND d.lease_expires_at > clock_timestamp())
               AS lease_active
        FROM event_deliveries d
        JOIN outbox_events e ON e.id = d.event_id
       WHERE e.channel_id = ${channelId}::uuid
         AND d.event_id = ${deliveryId}::uuid
         AND d.consumer = ${CHANNEL_SYNC_CONSUMER}
       FOR UPDATE OF d`);
    const row = rows[0];
    if (row === undefined) throw missing();
    if (row.status === 'COMPLETED') throw replayConflict();
    // Một lượt đang giữ lease còn hiệu lực thì không giành hàng của nó (cùng luật với relay HB-130).
    if (row.status === 'PROCESSING' && row.lease_active) throw retryInProgress();
    await tx.$executeRaw(Prisma.sql`
      UPDATE event_deliveries
         SET status = 'PENDING', lease_token = NULL, lease_expires_at = NULL,
             attempts = 0, completed_at = NULL, updated_at = clock_timestamp()
       WHERE event_id = ${deliveryId}::uuid AND consumer = ${CHANNEL_SYNC_CONSUMER}`);

    const operationId = randomUUID();
    const scope = scopeArray(actor.propertyScope);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO operations(id, kind, status, requested_by, property_scope, payload_json)
      VALUES (${operationId}::uuid, 'CHANNEL_DELIVERY_RETRY', 'PENDING', ${actor.id}::uuid, ${scope},
              ${JSON.stringify({
                channelId,
                eventId: deliveryId,
                consumerKey: CHANNEL_SYNC_CONSUMER,
              })}::jsonb)`);
    await this.audit.record(tx, {
      actor,
      action: 'CHANNEL_DELIVERY_RETRY_REQUESTED',
      entityType: 'EventDelivery',
      entityId: deliveryId,
      beforeJson: { channelId, status: row.status },
      afterJson: { channelId, eventId: deliveryId, consumerKey: CHANNEL_SYNC_CONSUMER },
      reason: null,
    });
    return { operationId, status: 'PENDING', statusUrl: channelOperationStatusUrl(operationId) };
  }
}
