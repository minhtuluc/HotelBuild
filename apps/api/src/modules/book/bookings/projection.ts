/**
 * Chiếu `bookings` → `BookingSummary` (api.md §3.2) và dựng truy vấn danh sách (api.md §1.5, §6.3).
 *
 * `createdBy`: hợp đồng khai `string` không rỗng nhưng cột `bookings.created_by` là FK `users` **nullable**
 * (booking do khách tạo không có người dùng nào). Với ca đó trả `guest_id` — chính chủ thể tạo lệnh, cùng
 * cách API giả lập của hành trình khách trả `'synthetic-guest'` (`tests/e2e/fake-api/journey`).
 *
 * Danh sách: khách bị buộc `guest_id = chính mình`; nhân viên lọc theo phạm vi cơ sở của
 * `principal.scopedPropertyIds` (BR-RBAC-02). Thứ tự và con trỏ theo đúng khuôn các endpoint đọc hiện
 * có (`crm/guests`, `noti`): `(created_at DESC, id DESC)`, con trỏ là `id` hàng cuối — `sort` được nhận
 * nhưng **không** đổi thứ tự tài nguyên, nên con trỏ không bao giờ nhảy hàng.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { bookingSummarySchema } from '@pinehill/contracts';
import type { BookingSummary, BookingsQuery, ListPage } from '@pinehill/contracts';
import { normalizePhone } from '../../crm/guests/phone.js';
import { civilDay, dateOnly, isCivilDate } from '../../rate/calendar/support.js';
import type { BookingCaller } from './principal.js';
import { scopedPropertyIds } from './principal.js';
import { invalid } from './validation.js';

/** Cột dùng cho projection và cho khoá con trỏ; không trả PII nào ngoài hợp đồng. */
export const bookingSelect = {
  id: true,
  code: true,
  seq: true,
  status: true,
  guest_id: true,
  property_id: true,
  room_type_id: true,
  rate_plan_id: true,
  channel_id: true,
  check_in: true,
  check_out: true,
  adults: true,
  children: true,
  room_count: true,
  total_amount: true,
  deposit_percent: true,
  deposit_amount: true,
  paid_amount: true,
  refunded_amount: true,
  penalty_amount: true,
  balance_due: true,
  reschedule_count: true,
  currency: true,
  hold_expires_at: true,
  oversold: true,
  price_locked: true,
  duplicate_suspected: true,
  channel_policy_code: true,
  note: true,
  created_by: true,
  created_at: true,
  version: true,
} satisfies Prisma.bookingsSelect;

export type BookingRow = Prisma.bookingsGetPayload<{ select: typeof bookingSelect }>;

export function project(row: BookingRow): BookingSummary {
  const checkIn = dateOnly(row.check_in);
  const checkOut = dateOnly(row.check_out);
  return bookingSummarySchema.parse({
    id: row.id,
    code: row.code,
    seq: Number(row.seq),
    status: row.status,
    guestId: row.guest_id,
    propertyId: row.property_id,
    roomTypeId: row.room_type_id,
    ratePlanId: row.rate_plan_id,
    channelId: row.channel_id,
    checkIn,
    checkOut,
    nights: civilDay(checkOut) - civilDay(checkIn),
    adults: row.adults,
    children: row.children,
    roomCount: row.room_count,
    totalAmount: Number(row.total_amount),
    depositPercent: Number(row.deposit_percent),
    depositAmount: Number(row.deposit_amount),
    paidAmount: Number(row.paid_amount),
    refundedAmount: Number(row.refunded_amount),
    balanceDue: Number(row.balance_due),
    penaltyAmount: Number(row.penalty_amount),
    currency: row.currency.trim(),
    rescheduleCount: row.reschedule_count,
    holdExpiresAt: row.hold_expires_at?.toISOString() ?? null,
    oversold: row.oversold,
    priceLocked: row.price_locked,
    duplicateSuspected: row.duplicate_suspected,
    channelPolicyCode: row.channel_policy_code,
    note: row.note,
    createdBy: row.created_by ?? row.guest_id,
    createdAt: row.created_at.toISOString(),
    version: Number(row.version),
  });
}

/**
 * `q` của api.md §1.5 khớp **SĐT đã chuẩn hoá**, `Booking.code` và mã phòng. SĐT chỉ được đưa vào truy
 * vấn khi chuỗi nhập đúng dạng số Việt Nam (`normalizePhone` ném lỗi với chuỗi khác, và mã booking là
 * chuỗi khác dạng nên không được biến thành lỗi 422).
 */
function phoneQuery(value: string): string | null {
  const compact = value.replaceAll(/[\s().-]/g, '');
  if (!/^(?:0\d{9}|84\d{9}|\+84\d{9})$/.test(compact)) return null;
  return normalizePhone(compact);
}

/** Ngày lọc phải là ngày lịch thật; `listQuerySchema` chỉ đòi chuỗi khác rỗng (api.md §1.5). */
function filterDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  if (!isCivilDate(value)) throw invalid();
  return new Date(`${value}T00:00:00.000Z`);
}

/** Điều kiện chủ sở hữu: khách chỉ thấy booking của mình, nhân viên theo phạm vi cơ sở (BR-RBAC-02). */
function ownershipFilter(caller: BookingCaller): Prisma.bookingsWhereInput {
  if (caller.type === 'GUEST') return { guest_id: caller.id };
  const scope = scopedPropertyIds(caller);
  return scope === null ? {} : { property_id: { in: [...scope] } };
}

/** `q` khớp mã booking, SĐT (đã chuẩn hoá) hoặc mã phòng đang gán — api.md §1.5. */
function searchFilter(q: string): Prisma.bookingsWhereInput {
  const phone = phoneQuery(q);
  return {
    OR: [
      { code: { contains: q, mode: 'insensitive' } },
      ...(phone === null ? [] : [{ guests: { is: { phone } } }]),
      {
        booking_rooms: {
          some: {
            room_assignments: { some: { rooms: { code: { contains: q, mode: 'insensitive' } } } },
          },
        },
      },
    ],
  };
}

export function bookingFilter(
  caller: BookingCaller,
  query: BookingsQuery,
): Prisma.bookingsWhereInput {
  const conditions: Prisma.bookingsWhereInput[] = [ownershipFilter(caller)];
  const from = filterDate(query.from);
  const to = filterDate(query.to);
  if (query.propertyId !== undefined) conditions.push({ property_id: query.propertyId });
  if (query.status !== undefined) conditions.push({ status: query.status });
  if (query.channelCode !== undefined)
    conditions.push({ channels: { is: { code: query.channelCode } } });
  if (from !== null) conditions.push({ check_in: { gte: from } });
  if (to !== null) conditions.push({ check_in: { lte: to } });
  if (query.q !== undefined) conditions.push(searchFilter(query.q));
  return { AND: conditions };
}

/** Trang kế tiếp theo cặp `(created_at, id)` giảm dần — cùng luật `crm/guests`/`noti`. */
export async function listBookings(
  db: PrismaClient,
  caller: BookingCaller,
  query: BookingsQuery,
): Promise<ListPage<BookingSummary>> {
  const where = bookingFilter(caller, query);
  // `query` là tham số readonly nhưng TS mất thu hẹp kiểu của thuộc tính sau `await`; giữ bản sao.
  const cursorId = query.cursor;
  return db.$transaction(
    async (tx) => {
      const total = await tx.bookings.count({ where });
      const cursor =
        cursorId === undefined
          ? null
          : await tx.bookings.findUnique({
              where: { id: cursorId },
              select: { created_at: true },
            });
      const after: Prisma.bookingsWhereInput | null =
        cursor === null || cursorId === undefined
          ? null
          : {
              OR: [
                { created_at: { lt: cursor.created_at } },
                { AND: [{ created_at: cursor.created_at }, { id: { lt: cursorId } }] },
              ],
            };
      const rows = await tx.bookings.findMany({
        where: after === null ? where : { AND: [where, after] },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        select: bookingSelect,
      });
      const hasMore = rows.length > query.limit;
      const data = (hasMore ? rows.slice(0, query.limit) : rows).map(project);
      return {
        data,
        meta: {
          limit: query.limit,
          hasMore,
          nextCursor: hasMore ? data.at(-1)!.id : null,
          total,
        },
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
