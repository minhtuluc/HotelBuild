/**
 * `GET /refund-requests` (HB-213; api.md §2.6, §6.3, §1.5): danh sách hồ sơ hoàn cho SCR-38.
 * Tuyến **đọc**: lọc phạm vi cơ sở ngay trong truy vấn (BR-RBAC-02), thứ tự tất định
 * `(created_at, id)` giảm dần, cursor là id hồ sơ và **chỉ** hợp lệ trong đúng bộ lọc hiện tại.
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ListPage, RefundListQuery, RefundRequest } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { refundError } from './validation.js';
import { requestViews } from './view.js';
import type { RefundRow } from './writes.js';

/** api.md §6.3: đọc hồ sơ hoàn là tập vận hành + ACCOUNTANT đối soát; HOUSEKEEPING/SYSADMIN không có. */
const readers: readonly string[] = [
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'MANAGER',
  'OWNER',
  'ACCOUNTANT',
];

/** Điều kiện SQL của bộ lọc; phạm vi cơ sở **luôn** là một điều kiện AND, không lọc sau khi đọc. */
function predicate(actor: AuthorizedActor, query: RefundListQuery): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (!actor.isOwner())
    parts.push(
      actor.propertyScope.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`b.property_id = ANY(${[...actor.propertyScope]}::uuid[])`,
    );
  if (query.status !== undefined) parts.push(Prisma.sql`r.status = ${query.status}`);
  if (query.bookingId !== undefined)
    parts.push(Prisma.sql`r.booking_id = ${query.bookingId}::uuid`);
  if (query.propertyId !== undefined)
    parts.push(Prisma.sql`b.property_id = ${query.propertyId}::uuid`);
  if (query.from !== undefined)
    parts.push(Prisma.sql`r.created_at >= ${new Date(query.from)}::timestamptz`);
  if (query.to !== undefined)
    parts.push(Prisma.sql`r.created_at <= ${new Date(query.to)}::timestamptz`);
  return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.join(parts, ' AND ');
}

export async function listRefunds(
  db: PrismaClient,
  actor: AuthorizedActor,
  query: RefundListQuery,
): Promise<ListPage<RefundRequest>> {
  // Phòng thủ nhiều lớp (§6.3): guard RBAC đã chặn, lớp ca sử dụng kiểm lại trước khi chạm dữ liệu.
  if (!readers.includes(actor.role)) throw refundError('forbidden');
  if (query.propertyId !== undefined) requireProperty(actor, query.propertyId);
  const source = Prisma.sql`FROM refund_requests r JOIN bookings b ON b.id = r.booking_id
    WHERE ${predicate(actor, query)}`;
  const cursorId = query.cursor;
  return db.$transaction(
    async (tx) => {
      const total = (await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n ${source}`)[0]!.n;
      const cursor =
        cursorId === undefined
          ? null
          : ((
              await tx.$queryRaw<{ created_at: Date }[]>`
              SELECT r.created_at ${source} AND r.id = ${cursorId}::uuid`
            )[0] ?? null);
      // Cursor của bộ lọc khác (hoặc ngoài phạm vi) không được lặng lẽ trả trang sai.
      if (cursorId !== undefined && cursor === null)
        throw refundError('invalid', 'Con trỏ không thuộc bộ lọc hiện tại.');
      const after =
        cursor === null
          ? Prisma.empty
          : Prisma.sql`AND (r.created_at, r.id) < (${cursor.created_at}::timestamptz, ${cursorId}::uuid)`;
      const rows = await tx.$queryRaw<RefundRow[]>`SELECT r.* ${source} ${after}
        ORDER BY r.created_at DESC, r.id DESC LIMIT ${query.limit + 1}`;
      const hasMore = rows.length > query.limit;
      const selected = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        data: await requestViews(tx, selected),
        meta: {
          limit: query.limit,
          hasMore,
          nextCursor: hasMore ? selected.at(-1)!.id : null,
          total: Number(total),
        },
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
