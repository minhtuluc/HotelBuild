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

/**
 * Một dòng hàng đợi OTA đã che PII: không payload inbox, không chữ ký/token/SĐT/email.
 *
 * Gồm hai nhóm trường cùng tồn tại: nhóm HB-131 (`code`, `externalRef`, `duplicateSuspected`, `checkIn`…,
 * test khoá chốt) và nhóm hợp đồng `otaBookingSchema` (HB-120) mà BFF/UI đọc. Nhóm sau điền từ `bookings`
 * + sự kiện inbox mới nhất khớp `external_ref` + sổ cái + case; không trường nào là số do giao diện tự tính.
 */
export interface OtaQueueRow {
  readonly id: string;
  readonly channelId: string;
  readonly code: string;
  readonly externalRef: string | null;
  readonly status: ProcessingStatus;
  readonly duplicateSuspected: boolean;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly receivedAt: string;
  readonly guestNameMasked: string | null;
  readonly eventType: string | null;
  readonly providerEventId: string | null;
  readonly providerBookingCode: string;
  readonly bookingId: string;
  readonly duplicate: boolean;
  readonly flagged: boolean;
  readonly flagReason: string | null;
  readonly flaggedBy: string | null;
  readonly flaggedAt: string | null;
  readonly oversold: boolean;
  readonly processedAt: string | null;
  readonly errorCode: string | null;
  readonly version: number;
  readonly paymentMethod: 'OTA_COLLECT' | null;
  readonly collectedAmount: number | null;
  readonly channelPolicyCode: string | null;
  readonly overbookingCaseId: string | null;
}

type ProcessingStatus = 'PENDING' | 'PROCESSED' | 'FAILED' | 'QUARANTINED';

interface RawRow {
  readonly id: string;
  readonly code: string;
  readonly external_ref: string | null;
  readonly booking_status: string;
  readonly duplicate_suspected: boolean;
  readonly duplicate_suspected_reason: string | null;
  readonly duplicate_suspected_by: string | null;
  readonly duplicate_suspected_at: Date | null;
  readonly oversold: boolean;
  readonly version: bigint;
  readonly channel_policy_code: string | null;
  readonly check_in: string;
  readonly check_out: string;
  readonly created_at: Date;
  readonly full_name: string | null;
  readonly event_type: string | null;
  readonly event_id: string | null;
  readonly event_status: string | null;
  readonly event_processed_at: Date | null;
  readonly event_error: string | null;
  readonly collected: bigint | null;
  readonly case_id: string | null;
}

/**
 * Trạng thái inbox → trạng thái xử lý của hợp đồng. `DEAD_LETTER` là cách ly bền (applier `quarantine`),
 * `FAILED` còn thử lại được. Không có sự kiện khớp ⇒ booking tồn tại tức đã được áp ⇒ `PROCESSED`.
 */
function processingStatus(inboxStatus: string | null): ProcessingStatus {
  if (inboxStatus === null || inboxStatus === 'PROCESSED') return 'PROCESSED';
  if (inboxStatus === 'DEAD_LETTER') return 'QUARANTINED';
  if (inboxStatus === 'FAILED') return 'FAILED';
  return 'PENDING';
}

/** Mã booking của OTA = đoạn sau `property/account/` của `external_ref` canonical (HB-129); thiếu ⇒ mã nội bộ. */
function providerCodeOf(row: RawRow): string {
  const code = row.external_ref?.replace(/^[^/]*\/[^/]*\//, '') ?? '';
  return code.length > 0 && code !== row.external_ref ? code : row.code;
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

const PROCESSING_STATUSES: ReadonlySet<string> = new Set([
  'PENDING',
  'PROCESSED',
  'FAILED',
  'QUARANTINED',
]);

/** Cùng ánh xạ với `processingStatus()` nhưng ở SQL để lọc/đếm trước khi phân trang. */
const PROCESSING_SQL = Prisma.sql`(CASE
  WHEN ev.status IS NULL OR ev.status = 'PROCESSED' THEN 'PROCESSED'
  WHEN ev.status = 'DEAD_LETTER' THEN 'QUARANTINED'
  WHEN ev.status = 'FAILED' THEN 'FAILED'
  ELSE 'PENDING' END)`;

/**
 * Sự kiện inbox **mới nhất** của booking, nối bằng khoá tự nhiên `property/account/providerCode` (cùng công
 * thức `externalRefOf` của HB-129). Chỉ lấy cột trạng thái/loại/mã lỗi; payload (PII, chữ ký) không rời SQL.
 */
const EVENT_JOIN = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT i.event_id, i.status, i.processed_at, i.last_error,
           i.payload_json->>'eventType' AS event_type
      FROM webhook_inbox i
     WHERE i.payload_json->>'channelCode' = ch.code
       AND (i.payload_json->>'propertyCode') || '/' || i.provider_account_id || '/'
           || (i.payload_json->>'providerBookingCode') = b.external_ref
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT 1
  ) ev ON true`;

function filterConditions(
  actor: AuthorizedActor,
  channelId: string,
  query: OtaQueueQuery,
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [Prisma.sql`b.channel_id = ${channelId}::uuid`];
  if (query.from !== null) conditions.push(Prisma.sql`b.check_in >= ${query.from}::date`);
  if (query.to !== null) conditions.push(Prisma.sql`b.check_in < ${query.to}::date`);
  if (query.status !== null)
    conditions.push(
      PROCESSING_STATUSES.has(query.status)
        ? Prisma.sql`${PROCESSING_SQL} = ${query.status}`
        : // Giá trị khác (HB-131 cũ) vẫn lọc theo trạng thái booking để không đổi hành vi đã phát hành.
          Prisma.sql`b.status = ${query.status}`,
    );
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
  const data = rows.slice(0, query.limit).map((row): OtaQueueRow => ({
    id: row.id,
    channelId,
    code: row.code,
    externalRef: row.external_ref,
    status: processingStatus(row.event_status),
    duplicateSuspected: row.duplicate_suspected,
    checkIn: row.check_in,
    checkOut: row.check_out,
    receivedAt: row.created_at.toISOString(),
    guestNameMasked: maskGuestName(row.full_name),
    eventType: row.event_type,
    providerEventId: row.event_id,
    providerBookingCode: providerCodeOf(row),
    bookingId: row.id,
    duplicate: row.duplicate_suspected,
    flagged: row.duplicate_suspected,
    flagReason: row.duplicate_suspected_reason,
    flaggedBy: row.duplicate_suspected_by,
    flaggedAt: row.duplicate_suspected_at?.toISOString() ?? null,
    oversold: row.oversold,
    processedAt: row.event_processed_at?.toISOString() ?? null,
    errorCode: row.event_error,
    version: Number(row.version),
    paymentMethod: row.collected === null ? null : 'OTA_COLLECT',
    collectedAmount: row.collected === null ? null : Number(row.collected),
    channelPolicyCode: row.channel_policy_code,
    overbookingCaseId: row.case_id,
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
        SELECT b.id, b.code, b.external_ref, b.status AS booking_status, b.duplicate_suspected,
               b.duplicate_suspected_reason, b.duplicate_suspected_by, b.duplicate_suspected_at,
               b.oversold, b.version, b.channel_policy_code,
               to_char(b.check_in, 'YYYY-MM-DD') AS check_in,
               to_char(b.check_out, 'YYYY-MM-DD') AS check_out,
               b.created_at, g.full_name,
               ev.event_type, ev.event_id, ev.status AS event_status,
               ev.processed_at AS event_processed_at, ev.last_error AS event_error,
               pay.collected, oc.case_id
          FROM bookings b
          JOIN channels ch ON ch.id = b.channel_id
          ${EVENT_JOIN}
          LEFT JOIN guests g ON g.id = b.guest_id
          LEFT JOIN LATERAL (
            SELECT SUM(p.amount)::bigint AS collected
              FROM payments p
             WHERE p.booking_id = b.id AND p.method = 'OTA_COLLECT' AND p.status = 'SUCCEEDED'
            HAVING count(*) > 0
          ) pay ON true
          LEFT JOIN LATERAL (
            SELECT c.id AS case_id
              FROM overbooking_cases c
             WHERE b.oversold AND c.property_id = b.property_id AND c.room_type_id = b.room_type_id
               AND c.date >= b.check_in AND c.date < b.check_out
             ORDER BY c.date, c.id
             LIMIT 1
          ) oc ON true
         WHERE ${page}
         ORDER BY b.check_in, b.id
         LIMIT ${query.limit + 1}`);
      const total = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n
          FROM bookings b
          JOIN channels ch ON ch.id = b.channel_id
          ${EVENT_JOIN}
         WHERE ${matching}`);
      return pageOf(rows, channelId, query, filter, Number(total[0]?.n ?? 0));
    });
  }
}
