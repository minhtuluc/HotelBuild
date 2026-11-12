/**
 * HB-242 (TD-09) — bảng điều khiển ngày SCR-23. Mọi nhóm đọc trong **một** giao dịch `RepeatableRead`
 * nên khách đến/đi/ở, ca quá tải và kênh cùng thuộc một ảnh chụp; `capturedAt` là đồng hồ CSDL của ảnh
 * chụp đó. Ngày mặc định = hôm nay theo giờ VN của chính đồng hồ CSDL (cùng nguồn với luật nghiệp vụ),
 * không lấy giờ máy chủ ứng dụng.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DAY_BOARD_ITEM_LIMIT,
  bookingStatusSchema,
  channelCodeSchema,
  dayBoardSchema,
  type DayBoard,
  type DayBoardBooking,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { forbidden, missing } from '../allotments/validation.js';
import type { DayBoardInput } from './validation.js';

const ROLES = ['FRONT_DESK', 'MANAGER', 'OWNER'];
const UNRESOLVED_CASES = ['OPEN', 'PROPOSED', 'ESCALATED'];

const bookingSelect = {
  id: true,
  code: true,
  room_type_id: true,
  room_count: true,
  check_in: true,
  check_out: true,
  status: true,
  balance_due: true,
  guests: { select: { full_name: true } },
  channels: { select: { code: true } },
} satisfies Prisma.bookingsSelect;

type BookingRow = Prisma.bookingsGetPayload<{ select: typeof bookingSelect }>;

export class DayBoardService {
  constructor(readonly db: PrismaClient) {}

  async get(actor: AuthorizedActor, input: DayBoardInput): Promise<DayBoard> {
    if (!ROLES.includes(actor.role)) throw forbidden();
    requireProperty(actor, input.propertyId);
    return this.db.$transaction((tx) => this.snapshot(tx, input), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async snapshot(tx: Prisma.TransactionClient, input: DayBoardInput): Promise<DayBoard> {
    const property = await tx.properties.findUnique({
      where: { id: input.propertyId },
      select: { id: true },
    });
    if (!property) throw missing();
    const [clock] = await tx.$queryRaw<{ now: Date; today: string }[]>`
      SELECT clock_timestamp() AS now,
             to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS today`;
    const date = input.date ?? clock!.today;
    const day = new Date(`${date}T00:00:00.000Z`);
    const scope = { property_id: input.propertyId };
    const [arrivals, departures, inHouse, openFromDate, onDate, degraded] = await Promise.all([
      group(tx, { ...scope, check_in: day, status: { in: ['CONFIRMED', 'CHECKED_IN'] } }),
      group(tx, { ...scope, check_out: day, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } }),
      group(tx, {
        ...scope,
        check_in: { lte: day },
        check_out: { gt: day },
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
      }),
      tx.overbooking_cases.count({
        where: { ...scope, date: { gte: day }, status: { in: UNRESOLVED_CASES } },
      }),
      tx.overbooking_cases.count({
        where: { ...scope, date: day, status: { in: UNRESOLVED_CASES } },
      }),
      tx.channels.findMany({
        where: { status: 'ACTIVE', sync_status: 'DEGRADED' },
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          consecutive_sync_failures: true,
          last_sync_at: true,
        },
      }),
    ]);
    return dayBoardSchema.parse({
      propertyId: input.propertyId,
      date,
      capturedAt: clock!.now.toISOString(),
      arrivals,
      departures,
      inHouse,
      overbooking: { openFromDate, onDate },
      degradedChannels: degraded.map((channel) => ({
        channelId: channel.id,
        code: channel.code,
        name: channel.name,
        consecutiveFailures: channel.consecutive_sync_failures,
        lastSyncAt: channel.last_sync_at?.toISOString() ?? null,
      })),
    });
  }
}

/** Đếm thật + tối đa `DAY_BOARD_ITEM_LIMIT` dòng, thứ tự ổn định theo mã booking. */
async function group(tx: Prisma.TransactionClient, where: Prisma.bookingsWhereInput) {
  const [total, rows] = await Promise.all([
    tx.bookings.count({ where }),
    tx.bookings.findMany({
      where,
      select: bookingSelect,
      orderBy: [{ code: 'asc' }],
      take: DAY_BOARD_ITEM_LIMIT,
    }),
  ]);
  return { total, items: rows.map(bookingItem), truncated: total > rows.length };
}

function bookingItem(row: BookingRow): DayBoardBooking {
  const balance = Number(row.balance_due);
  if (!Number.isSafeInteger(balance)) throw new Error('DAY_BOARD_BALANCE_UNREPRESENTABLE');
  return {
    bookingId: row.id,
    code: row.code,
    guestName: row.guests.full_name,
    roomTypeId: row.room_type_id,
    roomCount: row.room_count,
    checkIn: row.check_in.toISOString().slice(0, 10),
    checkOut: row.check_out.toISOString().slice(0, 10),
    status: bookingStatusSchema.parse(row.status),
    channelCode: channelCodeSchema.parse(row.channels.code),
    balanceDue: balance,
  };
}
