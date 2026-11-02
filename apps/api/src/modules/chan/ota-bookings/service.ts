import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ListPage } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { ChannelSyncService } from '../sync/service.js';
import {
  decodeQueueCursor,
  encodeQueueCursor,
  filterFingerprint,
  type OtaQueueQuery,
  type QueueCursor,
} from './validation.js';

/** Một dòng hàng đợi OTA đã che PII: không payload inbox, không chữ ký/token/SĐT/email. */
export interface OtaQueueRow {
  readonly id: string;
  readonly channelId: string;
  readonly code: string;
  readonly externalRef: string | null;
  readonly status: string;
  readonly duplicateSuspected: boolean;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly receivedAt: string;
  readonly guestNameMasked: string | null;
}

interface RawRow {
  readonly id: string;
  readonly code: string;
  readonly external_ref: string | null;
  readonly status: string;
  readonly duplicate_suspected: boolean;
  readonly check_in: string;
  readonly check_out: string;
  readonly created_at: Date;
  readonly full_name: string | null;
}

/** Che tên khách như các projection đối soát khác: chỉ giữ ký tự đầu, phần còn lại `***`. */
function maskGuestName(fullName: string | null): string | null {
  const trimmed = fullName?.trim() ?? '';
  return trimmed.length === 0 ? null : `${trimmed.slice(0, 1)}***`;
}

/** Phạm vi cơ sở **luôn** AND với bộ lọc của client; OWNER đọc toàn chuỗi. */
function scopeCondition(actor: AuthorizedActor): Prisma.Sql | null {
  if (actor.isOwner()) return null;
  return Prisma.sql`b.property_id IN (${Prisma.join(
    actor.propertyScope.map((propertyId) => Prisma.sql`${propertyId}::uuid`),
  )})`;
}

function filterConditions(
  actor: AuthorizedActor,
  channelId: string,
  query: OtaQueueQuery,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [Prisma.sql`b.channel_id = ${channelId}::uuid`];
  if (query.from !== null) conditions.push(Prisma.sql`b.check_in >= ${query.from}::date`);
  if (query.to !== null) conditions.push(Prisma.sql`b.check_in < ${query.to}::date`);
  if (query.status !== null) conditions.push(Prisma.sql`b.status = ${query.status}`);
  if (query.q !== null)
    conditions.push(
      Prisma.sql`(b.external_ref ILIKE ${`%${query.q}%`} OR b.code ILIKE ${`%${query.q}%`})`,
    );
  const scope = scopeCondition(actor);
  if (scope !== null) conditions.push(scope);
  return conditions;
}

function pageOf(
  rows: readonly RawRow[],
  channelId: string,
  query: OtaQueueQuery,
  filter: string,
  total: number,
): ListPage<OtaQueueRow> {
  const data = rows.slice(0, query.limit).map((row) => ({
    id: row.id,
    channelId,
    code: row.code,
    externalRef: row.external_ref,
    status: row.status,
    duplicateSuspected: row.duplicate_suspected,
    checkIn: row.check_in,
    checkOut: row.check_out,
    receivedAt: row.created_at.toISOString(),
    guestNameMasked: maskGuestName(row.full_name),
  }));
  const last = data.at(-1);
  const hasMore = rows.length > query.limit;
  return {
    data,
    meta: {
      limit: query.limit,
      total,
      hasMore,
      nextCursor:
        hasMore && last !== undefined
          ? encodeQueueCursor({ filter, checkIn: last.checkIn, id: last.id })
          : null,
    },
  };
}

/**
 * HB-131 / UC-CHAN-03 — hàng đợi booking nhận từ OTA (MANAGER/OWNER), lọc `from`/`to`/`status`/`q` và
 * phân trang keyset ổn định (`ORDER BY check_in, id`). Nguồn đọc là `bookings` của kênh **trong scope cơ
 * sở hiện tại**; payload webhook (chữ ký, token, SĐT/email) không bao giờ đi vào DTO này.
 */
export class ChannelOtaBookingsService {
  constructor(
    readonly db: PrismaClient,
    readonly channels: ChannelSyncService,
  ) {}

  async list(
    actor: AuthorizedActor,
    channelId: string,
    query: OtaQueueQuery,
  ): Promise<ListPage<OtaQueueRow>> {
    return this.db.$transaction(async (tx) => {
      await this.channels.loadChannel(tx, channelId);
      const emptyPage: ListPage<OtaQueueRow> = {
        data: [],
        meta: { limit: query.limit, total: 0, hasMore: false, nextCursor: null },
      };
      // Nhân viên không còn cơ sở nào trong scope: hàng đợi rỗng, không phải "kênh không tồn tại".
      if (!actor.isOwner() && actor.propertyScope.length === 0) return emptyPage;
      const filter = filterFingerprint({
        channelId,
        from: query.from,
        to: query.to,
        status: query.status,
        q: query.q,
        scope: actor.propertyScope,
      });
      const cursor: QueueCursor | null =
        query.cursor === null ? null : decodeQueueCursor(query.cursor);
      if (cursor !== null && cursor.filter !== filter)
        throw new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Con trỏ không thuộc bộ lọc hiện tại.');
      const matching = Prisma.join(filterConditions(actor, channelId, query), ' AND ');
      const page =
        cursor === null
          ? matching
          : Prisma.join(
              [
                Prisma.sql`(${matching})`,
                Prisma.sql`(b.check_in, b.id) > (${cursor.checkIn}::date, ${cursor.id}::uuid)`,
              ],
              ' AND ',
            );
      const rows = await tx.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT b.id, b.code, b.external_ref, b.status, b.duplicate_suspected,
               to_char(b.check_in, 'YYYY-MM-DD') AS check_in,
               to_char(b.check_out, 'YYYY-MM-DD') AS check_out,
               b.created_at, g.full_name
          FROM bookings b
          LEFT JOIN guests g ON g.id = b.guest_id
         WHERE ${page}
         ORDER BY b.check_in, b.id
         LIMIT ${query.limit + 1}`);
      const total = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM bookings b WHERE ${matching}`);
      return pageOf(rows, channelId, query, filter, Number(total[0]?.n ?? 0));
    });
  }
}
