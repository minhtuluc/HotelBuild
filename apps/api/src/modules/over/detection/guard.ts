/**
 * Guard bán vượt trong transaction tạo booking F4 (F6-D07, BR-OVER-01..03).
 *
 * Một lời gọi mỏng **sau khi đã khoá tồn**: chỉ chạy khi `planHold` đã thất bại. Guard kiểm đúng bảng
 * quyết định §4.1 — hạn mức cơ sở > 0, kênh cho phép, hết phòng **vật lý**, và số booking đã vượt
 * trong `(cơ sở, ngày nhận phòng)` còn dưới trần
 * `max(1, ceil(số phòng ACTIVE × pct / 100))`. Hết trần ⇒ `409 E_OVER_LIMIT_EXCEEDED`.
 */
import type { Prisma } from '@prisma/client';
import { calculateAvailability } from '@pinehill/domain/inventory';
import type { Availability, ChannelCode } from '@pinehill/domain/inventory';
import type { Clock } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import { loadInventoryFacts } from '../../inv/facts/loader.js';

export interface OversellInput {
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly roomCount: number;
  readonly channelCode: ChannelCode;
}

const ACTIVE_BOOKING_STATUS = ['CANCELLED', 'EXPIRED', 'NO_SHOW'];

async function physicallyFull(
  tx: Prisma.TransactionClient,
  clock: Clock,
  input: OversellInput,
): Promise<boolean> {
  const facts = await loadInventoryFacts(tx, {
    propertyId: input.propertyId,
    roomTypeId: input.roomTypeId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    channelCode: input.channelCode,
  });
  const normalized = { ...facts, now: clock.now() };
  const result = calculateAvailability(normalized);
  let availability: Availability;
  if (result.ok) availability = result.value;
  else if (result.error.code === 'E_INV_INVALID_INPUT') return false;
  else availability = result.error.availability;
  return availability.nightly.some((night) => night.pool < input.roomCount);
}

async function activeRoomCount(tx: Prisma.TransactionClient, propertyId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total
      FROM rooms r JOIN room_types t ON t.id = r.room_type_id
     WHERE r.property_id = ${propertyId}::uuid AND r.status = 'ACTIVE' AND t.status = 'ACTIVE'`;
  return Number(rows[0]?.total ?? 0);
}

async function oversoldCount(
  tx: Prisma.TransactionClient,
  propertyId: string,
  checkIn: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total FROM bookings
     WHERE property_id = ${propertyId}::uuid AND oversold = true
       AND check_in = ${checkIn}::date AND status <> ALL(${ACTIVE_BOOKING_STATUS}::text[])`;
  return Number(rows[0]?.total ?? 0);
}

/** `true` = cho phép ghi booking `oversold` không gán phòng; `false` = để F4 trả lỗi tồn như cũ. */
export async function allowOversell(
  tx: Prisma.TransactionClient,
  clock: Clock,
  input: OversellInput,
): Promise<boolean> {
  const settings = await tx.$queryRaw<
    { pct: string; overbook_allowed: boolean }[]
  >`SELECT p.overbook_limit_pct::text AS pct, c.overbook_allowed
       FROM properties p JOIN channels c ON c.code = ${input.channelCode}
      WHERE p.id = ${input.propertyId}::uuid`;
  const setting = settings[0];
  const pct = Number(setting?.pct ?? 0);
  if (
    setting === undefined ||
    !Number.isFinite(pct) ||
    pct <= 0 ||
    setting.overbook_allowed !== true
  )
    return false;
  if (!(await physicallyFull(tx, clock, input))) return false;
  const cap = Math.max(1, Math.ceil(((await activeRoomCount(tx, input.propertyId)) * pct) / 100));
  if ((await oversoldCount(tx, input.propertyId, input.checkIn)) >= cap)
    throw new AppError(
      409,
      'E_OVER_LIMIT_EXCEEDED',
      'Đã hết hạn mức bán vượt của cơ sở cho ngày nhận phòng này.',
    );
  return true;
}
