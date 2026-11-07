import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { OperationRef } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import {
  CHANNEL_INVENTORY_EVENT,
  channelOperationStatusUrl,
} from '../../../worker-runtime/channel-sync.js';
import { invalid, missing } from '../../sys/settings/validation.js';
import { applyAutoClosures, isOtaChannelCode, OTA_CHANNEL_CODES } from './projection.js';
import { scopeArray } from './scope-sql.js';
import { roomTypeIdsInput } from './validation.js';
import type { SyncInput } from './validation.js';

/** Khoảng đồng bộ **mặc định** cho `scope = FULL`: 90 đêm kể từ ngày nghiệp vụ hiện tại. */
export const FULL_SYNC_DAYS = 90;

interface ChannelRow {
  readonly id: string;
  readonly code: string;
  readonly version: bigint;
}

/**
 * HB-131 / UC-CHAN-02 — yêu cầu đồng bộ một kênh.
 *
 * Lệnh **không** gọi OTA: phần quyết định tồn (tự đóng bán theo ngưỡng, hạn mức 80%) được tính và ghi
 * lại ngay trong transaction của lệnh idempotency, còn việc đẩy ảnh tồn/giá sang OTA là tác vụ 202 do
 * `q.channel-sync` thực hiện (`operations.kind = 'CHANNEL_SYNC'`). Nhờ vậy OTA chỉ nhận ảnh đã kẹp quota
 * (BR-CHAN-06) và không có I/O mạng nào nằm trong transaction.
 */
export class ChannelSyncService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly timezone: string,
    readonly audit: AuditWriter,
  ) {}

  async loadChannel(tx: Prisma.TransactionClient, channelId: string): Promise<ChannelRow> {
    const rows = await tx.$queryRaw<ChannelRow[]>(Prisma.sql`
      SELECT id, code, version FROM channels WHERE id = ${channelId}::uuid`);
    const row = rows[0];
    if (row === undefined) throw missing();
    return row;
  }

  /** Loại phòng theo id (404 khi không tồn tại) — dùng chung cho các lệnh CHAN cần kiểm cơ sở. */
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

  /** Các kênh OTA đang hoạt động — phạm vi của luật đóng bán tự động (BR-CHAN-05). */
  async otaChannels(
    tx: Prisma.TransactionClient,
  ): Promise<readonly { readonly id: string; readonly code: string }[]> {
    return tx.$queryRaw<{ id: string; code: string }[]>(Prisma.sql`
      SELECT id, code FROM channels
       WHERE code = ANY(${OTA_CHANNEL_CODES}::text[]) AND status = 'ACTIVE'
       ORDER BY code`);
  }

  /**
   * Loại phòng của lệnh, **đã kiểm scope hiện tại**: không nhận scope từ body hay cursor; mỗi loại phòng
   * phải thuộc cơ sở mà người gọi đang được phép tác động (BR-RBAC-02). `null` nghĩa là mọi loại phòng
   * trong scope (OWNER: toàn chuỗi).
   */
  async authorizedRoomTypes(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    requested: readonly string[] | null,
  ): Promise<readonly string[]> {
    if (requested !== null) {
      const ids = roomTypeIdsInput(requested);
      for (const id of ids) {
        const type = await tx.room_types.findUnique({
          where: { id },
          select: { property_id: true },
        });
        if (type === null) throw missing();
        requireProperty(actor, type.property_id);
      }
      return ids;
    }
    const types = await tx.room_types.findMany({
      where: actor.isOwner() ? {} : { property_id: { in: [...actor.propertyScope] } },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return types.map((type) => type.id);
  }

  /** Ngày nghiệp vụ hiện tại theo múi giờ vận hành (`YYYY-MM-DD`), không theo UTC của máy chủ. */
  private today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.clock.now());
  }

  private window(input: SyncInput): { readonly from: string; readonly to: string } {
    if (input.scope === 'RANGE') {
      if (input.from === null || input.to === null) throw invalid();
      return { from: input.from, to: input.to };
    }
    const from = this.today();
    const end = new Date(`${from}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + FULL_SYNC_DAYS);
    return { from, to: end.toISOString().slice(0, 10) };
  }

  private async pushEvent(
    tx: Prisma.TransactionClient,
    channelId: string,
    version: number,
    roomTypeIds: readonly string[],
    from: string,
    to: string,
  ): Promise<void> {
    const payload = {
      schemaVersion: 1,
      channelId,
      aggregateVersion: version,
      roomTypeIds,
      from,
      to,
    };
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO outbox_events(event_type, aggregate_type, aggregate_id, channel_id, payload_json)
      VALUES (${CHANNEL_INVENTORY_EVENT}, 'Channel', ${channelId}::uuid, ${channelId}::uuid,
              ${JSON.stringify(payload)}::jsonb)`);
  }

  async request(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    channelId: string,
    input: SyncInput,
  ): Promise<OperationRef> {
    const channel = await this.loadChannel(tx, channelId);
    if (!isOtaChannelCode(channel.code))
      throw new AppError(
        400,
        'E_GEN_VALIDATION_FAILED',
        'Chỉ đồng bộ được kênh OTA; kênh trực tiếp bán theo tồn chung.',
      );
    const roomTypeIds = await this.authorizedRoomTypes(tx, actor, input.roomTypeIds);
    const { from, to } = this.window(input);

    // Ghi lại quyết định tồn trước khi trả 202: OTA chỉ thấy ảnh đã kẹp quota (BR-CHAN-06).
    const projection = await applyAutoClosures(
      tx,
      await this.otaChannels(tx),
      roomTypeIds,
      from,
      to,
    );

    // Phiên bản ảnh chụp: tăng theo mỗi lần quyết định tồn để consumer bỏ qua ảnh cũ (BR-CHAN-06).
    await tx.$executeRaw(Prisma.sql`
      UPDATE channels SET updated_at = clock_timestamp() WHERE id = ${channelId}::uuid`);
    const versionRows = await tx.$queryRaw<{ version: bigint }[]>(Prisma.sql`
      SELECT version FROM channels WHERE id = ${channelId}::uuid`);
    const version = Number(versionRows[0]?.version ?? channel.version);

    if (projection.changed > 0)
      for (const ota of await this.otaChannels(tx))
        await this.pushEvent(tx, ota.id, version, roomTypeIds, from, to);

    const operationId = randomUUID();
    const scope = scopeArray(actor.propertyScope);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO operations(id, kind, status, requested_by, property_scope, payload_json)
      VALUES (${operationId}::uuid, 'CHANNEL_SYNC', 'PENDING', ${actor.id}::uuid, ${scope},
              ${JSON.stringify({
                channelId,
                code: channel.code,
                scope: input.scope,
                from,
                to,
                roomTypeIds,
                version,
              })}::jsonb)`);
    await this.audit.record(tx, {
      actor,
      action: 'CHANNEL_SYNC_REQUESTED',
      entityType: 'Channel',
      entityId: channelId,
      beforeJson: null,
      afterJson: {
        channelId,
        from,
        to,
        roomTypeIds,
        version,
        closedNights: projection.closed,
      },
      reason: null,
    });
    return { operationId, status: 'PENDING', statusUrl: channelOperationStatusUrl(operationId) };
  }
}
