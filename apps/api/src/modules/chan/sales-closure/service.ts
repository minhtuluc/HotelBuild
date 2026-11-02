import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { SalesClosureView } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CHANNEL_INVENTORY_EVENT } from '../../../worker-runtime/channel-sync.js';
import { ChannelSyncService } from '../sync/service.js';
import { AUTO_CLOSURE_REASON, allotmentPct, nightlySupply, quotaFor } from '../sync/projection.js';
import { closureDates, type ClosureInput } from './validation.js';

interface ClosureRow {
  readonly date: string;
  readonly is_closed: boolean;
  readonly manual_closed: boolean;
  readonly auto_closed: boolean;
  readonly closed_reason: string | null;
  readonly closed_at: Date | null;
  readonly manual_reopened_at: Date | null;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/**
 * HB-131 / UC-CHAN-01, BR-CHAN-05 — đóng/mở bán loại phòng theo ngày trên một kênh (MANAGER/OWNER).
 *
 * Hai nguồn đóng bán tách biệt:
 * - **manual**: lệnh này, có người đóng + lý do; mở thủ công chỉ gỡ được phần này.
 * - **automatic**: kết quả tính tồn (`pool ≤ channel.lowInventoryThreshold`), được `sync` tái lập.
 *
 * `channel_allotments.is_closed` là cờ hiệu lực cho loader tồn; `manual_closed`/`auto_closed` là
 * provenance, còn `channel_sales_closures` (HB-121) lưu lịch sử mở/đóng của nguồn MANUAL kèm người thực
 * hiện. Audit + outbox + thay đổi trạng thái nằm trong **cùng** transaction của lệnh idempotency.
 */
export class ChannelSalesClosureService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
    readonly channels: ChannelSyncService,
  ) {}

  private async writeAllotment(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    channelId: string,
    input: ClosureInput,
    date: string,
    quota: number,
  ): Promise<void> {
    if (input.closed) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO channel_allotments(
          channel_id, room_type_id, date, allotment, is_closed, closed_reason, closed_at,
          manual_closed, closed_by, auto_closed)
        VALUES (${channelId}::uuid, ${input.roomTypeId}::uuid, ${date}::date, ${quota},
                true, ${input.reason}, clock_timestamp(), true, ${actor.id}::uuid, false)
        ON CONFLICT (channel_id, room_type_id, date) DO UPDATE
           SET allotment = EXCLUDED.allotment,
               manual_closed = true,
               is_closed = true,
               closed_reason = EXCLUDED.closed_reason,
               closed_by = EXCLUDED.closed_by,
               closed_at = CASE WHEN channel_allotments.is_closed
                                THEN channel_allotments.closed_at
                                ELSE EXCLUDED.closed_at END`);
      // Sổ lịch sử theo nguồn (HB-121): một dòng MANUAL đang mở cho mỗi (kênh, loại phòng, đêm).
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO channel_sales_closures(channel_id, room_type_id, date, source, reason, closed_by)
        VALUES (${channelId}::uuid, ${input.roomTypeId}::uuid, ${date}::date, 'MANUAL',
                ${input.reason}, ${actor.id}::uuid)
        ON CONFLICT (channel_id, room_type_id, date, source) WHERE reopened_at IS NULL
        DO UPDATE SET reason = EXCLUDED.reason,
                      closed_by = EXCLUDED.closed_by,
                      closed_at = clock_timestamp()`);
      return;
    }
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO channel_allotments(
        channel_id, room_type_id, date, allotment, is_closed, manual_closed, auto_closed)
      VALUES (${channelId}::uuid, ${input.roomTypeId}::uuid, ${date}::date, ${quota},
              false, false, false)
      ON CONFLICT (channel_id, room_type_id, date) DO UPDATE
         SET allotment = EXCLUDED.allotment,
             manual_closed = false,
             is_closed = channel_allotments.auto_closed,
             closed_reason = CASE WHEN channel_allotments.auto_closed
                                  THEN channel_allotments.closed_reason ELSE NULL END,
             closed_by = CASE WHEN channel_allotments.auto_closed
                              THEN channel_allotments.closed_by ELSE NULL END`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE channel_sales_closures
         SET reopened_at = clock_timestamp(), reopened_by = ${actor.id}::uuid
       WHERE channel_id = ${channelId}::uuid
         AND room_type_id = ${input.roomTypeId}::uuid
         AND date = ${date}::date
         AND source = 'MANUAL'
         AND reopened_at IS NULL`);
  }

  private async view(
    tx: Prisma.TransactionClient,
    channelId: string,
    roomTypeId: string,
    from: string,
    to: string,
  ): Promise<SalesClosureView> {
    const rows = await tx.$queryRaw<ClosureRow[]>(Prisma.sql`
      SELECT to_char(a.date, 'YYYY-MM-DD') AS date, a.is_closed, a.manual_closed, a.auto_closed,
             a.closed_reason, a.closed_at,
             (SELECT max(c.reopened_at) FROM channel_sales_closures c
               WHERE c.channel_id = a.channel_id AND c.room_type_id = a.room_type_id
                 AND c.date = a.date AND c.source = 'MANUAL') AS manual_reopened_at
        FROM channel_allotments a
       WHERE a.channel_id = ${channelId}::uuid
         AND a.room_type_id = ${roomTypeId}::uuid
         AND a.date >= ${from}::date AND a.date < ${to}::date
       ORDER BY a.date`);
    return {
      channelId,
      rows: rows.map((row) => ({
        roomTypeId,
        date: row.date,
        closed: row.is_closed,
        closureSource: row.manual_closed ? 'MANUAL' : row.auto_closed ? 'AUTOMATIC' : null,
        manual: {
          closed: row.manual_closed,
          reason: row.manual_closed ? row.closed_reason : null,
          closedAt: row.manual_closed ? iso(row.closed_at) : null,
          reopenedAt: iso(row.manual_reopened_at),
        },
        automatic: {
          closed: row.auto_closed,
          reason: row.auto_closed ? AUTO_CLOSURE_REASON : null,
          closedAt: row.auto_closed ? iso(row.closed_at) : null,
          reopenedAt: null,
        },
      })),
    };
  }

  async apply(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    channelId: string,
    input: ClosureInput,
  ): Promise<SalesClosureView> {
    const channel = await this.channels.loadChannel(tx, channelId);
    const type = await this.channels.loadRoomType(tx, input.roomTypeId);
    requireProperty(actor, type.property_id);

    const dates = closureDates(input.from, input.to);
    const supply = await nightlySupply(tx, [input.roomTypeId], input.from, input.to);
    const supplyByDate = new Map(supply.map((night) => [night.date, night.units] as const));
    const pct = await allotmentPct(tx, channelId, input.roomTypeId);
    await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1s'`);
    for (const date of dates)
      await this.writeAllotment(
        tx,
        actor,
        channelId,
        input,
        date,
        quotaFor(supplyByDate.get(date) ?? 0, pct),
      );

    await tx.$executeRaw(Prisma.sql`
      UPDATE channels SET updated_at = clock_timestamp() WHERE id = ${channelId}::uuid`);
    const nextRows = await tx.$queryRaw<{ version: bigint }[]>(Prisma.sql`
      SELECT version FROM channels WHERE id = ${channelId}::uuid`);
    const version = Number(nextRows[0]?.version ?? channel.version);

    await this.audit.record(tx, {
      actor,
      action: input.closed ? 'CHANNEL_SALES_CLOSED' : 'CHANNEL_SALES_REOPENED',
      entityType: 'ChannelSalesClosure',
      entityId: type.id,
      beforeJson: null,
      afterJson: {
        channelId,
        roomTypeId: input.roomTypeId,
        from: input.from,
        to: input.to,
        closed: input.closed,
        dates,
      },
      reason: input.reason,
    });
    // BR-CHAN-06: đóng/mở bán là thay đổi tồn đã commit ⇒ đẩy ngay ở lượt quét kế tiếp.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, channel_id, payload_json)
      VALUES (${CHANNEL_INVENTORY_EVENT}, 'Channel', ${channelId}::uuid, ${channelId}::uuid,
              ${JSON.stringify({
                schemaVersion: 1,
                channelId,
                roomTypeId: input.roomTypeId,
                aggregateVersion: version,
                from: input.from,
                to: input.to,
                closed: input.closed,
              })}::jsonb)`);
    return this.view(tx, channelId, input.roomTypeId, input.from, input.to);
  }
}
