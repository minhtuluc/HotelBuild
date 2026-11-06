/**
 * Dữ kiện tồn cho phát hiện quá tải (HB-126).
 *
 * Dùng **đúng** engine tồn của HB-032 (`loadInventoryFacts` + `calculateAvailability`) chứ không đếm
 * assignment lần hai: `BookingRoom` đang hiệu lực vẫn là nhu cầu kể cả khi chưa gán phòng, hold
 * `HELD`/`PENDING_PAYMENT` chỉ hiệu lực khi `hold_expires_at > now`, `DOR` bán theo giường, block
 * chồng nhau chỉ trừ một đơn vị (BR-INV-01/04/07, BR-OVER-05).
 *
 * `now` của engine là **Clock tiêm** (không phải `clock_timestamp()`): job quét và guard F4 phải cùng
 * một nguồn thời gian, nếu không hold hết hạn sẽ được tính khác nhau giữa hai đường.
 */
import type { Prisma } from '@prisma/client';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type {
  Availability,
  AvailabilityInput,
  ChannelCode,
  Demand,
  Location,
} from '@pinehill/domain/inventory';
import { loadInventoryFacts } from '../../inv/facts/loader.js';
import { addDays, businessDate, propertyMeta } from './support.js';
import type { PropertyMeta } from './support.js';

const DETECTION_CHANNEL: ChannelCode = 'WEB';

export interface TypeFacts {
  readonly id: string;
  readonly basePrice: bigint;
  /** `pool` (supply − nhu cầu hiệu lực) theo ngày; âm nghĩa là thiếu đúng trị tuyệt đối. */
  readonly pools: ReadonlyMap<string, number>;
  /** Dữ kiện thô để lấy nhu cầu/ứng viên của từng đêm. */
  readonly facts: AvailabilityInput;
}

export interface PropertyFacts {
  readonly meta: PropertyMeta;
  readonly today: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly dates: readonly string[];
  readonly types: readonly TypeFacts[];
}

export interface WindowOptions {
  /** Chỉ tính đúng các ngày này (guard F4); bỏ trống = cửa sổ 30 ngày tới theo ngày VN. */
  readonly dates?: readonly string[];
  readonly roomTypeId?: string;
}

export function shortageDates(dates: readonly string[], types: readonly TypeFacts[]) {
  const found: { date: string; type: TypeFacts; shortage: number }[] = [];
  for (const type of types)
    for (const date of dates) {
      const pool = type.pools.get(date);
      if (pool !== undefined && pool < 0) found.push({ date, type, shortage: -pool });
    }
  return found;
}

function effectiveDemand(demand: Demand, now: Date): boolean {
  if (demand.status === 'CONFIRMED' || demand.status === 'CHECKED_IN') return true;
  if (demand.status !== 'HELD' && demand.status !== 'PENDING_PAYMENT') return false;
  return (demand.holdExpiresAt?.getTime() ?? Number.NEGATIVE_INFINITY) > now.getTime();
}

function demandLocation(demand: Demand): Location {
  return demand.allocatedLocation ?? demand;
}

/** Nhu cầu hiệu lực của đúng đêm/đúng vị trí bán (khớp `nightlyDemand` của engine HB-032). */
export function demandOn(
  facts: AvailabilityInput,
  date: string,
  location: Location,
  now: Date,
): readonly Demand[] {
  const unique = new Map<string, Demand>();
  for (const demand of facts.demand) {
    if (!(demand.checkIn <= date && date < demand.checkOut)) continue;
    if (!effectiveDemand(demand, now)) continue;
    const actual = demandLocation(demand);
    if (actual.propertyId !== location.propertyId || actual.roomTypeId !== location.roomTypeId)
      continue;
    unique.set(demand.bookingRoomId, demand);
  }
  return [...unique.values()];
}

export async function loadPropertyFacts(
  db: Prisma.TransactionClient,
  propertyId: string,
  now: Date,
  options: WindowOptions = {},
): Promise<PropertyFacts> {
  const meta = await propertyMeta(db, propertyId);
  const today = businessDate(now, meta.timezone);
  const dates = options.dates ?? window(today);
  const windowStart = dates[0] ?? today;
  const windowEnd = addDays(dates.at(-1) ?? today, 1);
  const roomTypes = await db.room_types.findMany({
    where: { property_id: propertyId, status: 'ACTIVE' },
    select: { id: true, base_price: true },
    orderBy: { id: 'asc' },
  });
  const types: TypeFacts[] = [];
  for (const type of roomTypes) {
    if (options.roomTypeId !== undefined && type.id !== options.roomTypeId) continue;
    const facts = await loadInventoryFacts(db, {
      propertyId,
      roomTypeId: type.id,
      checkIn: windowStart,
      checkOut: windowEnd,
      channelCode: DETECTION_CHANNEL,
    });
    const normalized = { ...facts, now };
    const result = calculateAvailability(normalized);
    let availability: Availability;
    if (result.ok) availability = result.value;
    else if (result.error.code === 'E_INV_INVALID_INPUT')
      throw new Error('Invalid inventory facts for overbooking detection');
    else availability = result.error.availability;
    types.push({
      id: type.id,
      basePrice: type.base_price,
      pools: new Map(availability.nightly.map((night) => [night.date, night.pool])),
      facts: normalized,
    });
  }
  return { meta, today, windowStart, windowEnd, dates, types };
}

/** 30 ngày tới theo **ngày VN**, không phải 30×24h từ UTC. */
export function window(today: string): string[] {
  return Array.from({ length: 30 }, (_, index) => addDays(today, index));
}
