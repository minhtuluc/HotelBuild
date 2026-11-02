import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { requireProperty } from '../../../common/rbac/scope.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CHANNEL_INVENTORY_EVENT } from '../../../worker-runtime/channel-sync.js';
import { missing } from '../../sys/settings/validation.js';
import { mappingConflict, versionConflict, type MappingInput } from './validation.js';

interface ChannelRow {
  readonly id: string;
  readonly code: string;
  readonly version: bigint;
}

interface MappingRow {
  readonly room_type_id: string;
  readonly external_room_code: string;
  readonly external_rate_plan_code: string | null;
  readonly status: string;
  readonly allotment_pct: number;
}

/**
 * HB-131 / UC-CHAN-01 — cấu hình ánh xạ loại phòng ↔ mã phòng OTA (quyền OWNER).
 *
 * `If-Match` là version **của kênh**; mỗi lần ghi cấu hình đều tăng version kênh trong cùng transaction
 * với audit + outbox, nên client đọc lại `ETag` là có mốc so sánh kế tiếp. Bản thân quota không đổi
 * `used` và không ghi đè tổng quota các kênh (BR-INV-05).
 */
export class ChannelMappingsService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {}

  async loadChannel(tx: Prisma.TransactionClient, channelId: string): Promise<ChannelRow> {
    const rows = await tx.$queryRaw<ChannelRow[]>(Prisma.sql`
      SELECT id, code, version FROM channels WHERE id = ${channelId}::uuid`);
    const row = rows[0];
    if (row === undefined) throw missing();
    return row;
  }

  async loadRoomType(
    tx: Prisma.TransactionClient,
    roomTypeId: string,
  ): Promise<{ readonly id: string; readonly property_id: string }> {
    const type = await tx.room_types.findUnique({
      where: { id: roomTypeId },
      select: { id: true, property_id: true },
    });
    if (type === null) throw missing();
    return type;
  }

  /** BR-CHAN-08: một mã phòng OTA chỉ thuộc **một** loại phòng trong cùng kênh. */
  async assertProviderCodeFree(
    tx: Prisma.TransactionClient,
    channelId: string,
    roomTypeId: string,
    providerRoomTypeCode: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ room_type_id: string }[]>(Prisma.sql`
      SELECT room_type_id FROM channel_mappings
       WHERE channel_id = ${channelId}::uuid
         AND external_room_code = ${providerRoomTypeCode}
         AND room_type_id <> ${roomTypeId}::uuid
       LIMIT 1`);
    if (rows.length > 0) throw mappingConflict();
  }

  private async readMapping(
    tx: Prisma.TransactionClient,
    channelId: string,
    roomTypeId: string,
  ): Promise<MappingRow | null> {
    const rows = await tx.$queryRaw<MappingRow[]>(Prisma.sql`
      SELECT room_type_id, external_room_code, external_rate_plan_code, status, allotment_pct
        FROM channel_mappings
       WHERE channel_id = ${channelId}::uuid AND room_type_id = ${roomTypeId}::uuid`);
    return rows[0] ?? null;
  }

  /** Ghi cấu hình trong transaction của lệnh idempotency; trả `ETag` mới của kênh. */
  async put(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    channelId: string,
    input: MappingInput,
    expected: bigint,
  ): Promise<string> {
    const channel = await this.loadChannel(tx, channelId);
    await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1s'`);
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM channels WHERE id = ${channelId}::uuid FOR UPDATE`);
    if (channel.version !== expected) throw versionConflict();
    await this.assertProviderCodeFree(tx, channelId, input.roomTypeId, input.providerRoomTypeCode);
    const type = await this.loadRoomType(tx, input.roomTypeId);
    requireProperty(actor, type.property_id);

    const before = await this.readMapping(tx, channelId, input.roomTypeId);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO channel_mappings(
        channel_id, room_type_id, external_room_code, external_rate_plan_code, status, allotment_pct)
      VALUES (${channelId}::uuid, ${input.roomTypeId}::uuid, ${input.providerRoomTypeCode},
              ${input.externalRatePlanCode}, ${input.status}, ${input.allotmentPct})
      ON CONFLICT (channel_id, room_type_id) DO UPDATE
         SET external_room_code = EXCLUDED.external_room_code,
             external_rate_plan_code = EXCLUDED.external_rate_plan_code,
             status = EXCLUDED.status,
             allotment_pct = EXCLUDED.allotment_pct`);

    // Version kênh là mốc `If-Match` của cả bộ cấu hình CHAN: tăng đúng một lần cho mỗi lệnh ghi.
    await tx.$executeRaw(Prisma.sql`
      UPDATE channels SET updated_at = clock_timestamp() WHERE id = ${channelId}::uuid`);
    const nextRows = await tx.$queryRaw<{ version: bigint }[]>(Prisma.sql`
      SELECT version FROM channels WHERE id = ${channelId}::uuid`);
    const next = nextRows[0]?.version ?? channel.version;
    const after = await this.readMapping(tx, channelId, input.roomTypeId);

    await this.audit.record(tx, {
      actor,
      action: 'CHANNEL_MAPPING_UPSERTED',
      entityType: 'ChannelMapping',
      entityId: input.roomTypeId,
      beforeJson: before === null ? null : { ...before },
      afterJson: after === null ? null : { ...after },
      reason: null,
    });
    // BR-CHAN-06: thay đổi cấu hình kích đồng bộ ngay; payload chỉ là mốc version, không phải quota thô.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, channel_id, payload_json)
      VALUES (${CHANNEL_INVENTORY_EVENT}, 'Channel', ${channelId}::uuid, ${channelId}::uuid,
              ${JSON.stringify({
                schemaVersion: 1,
                channelId,
                roomTypeId: input.roomTypeId,
                aggregateVersion: Number(next),
              })}::jsonb)`);
    return `"${next.toString()}"`;
  }
}
