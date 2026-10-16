/**
 * Loader dữ kiện giá (HB-056 AC1) — dựng đầu vào engine `@pinehill/domain/pricing` từ CSDL.
 *
 * Mọi bề mặt báo giá (`POST /quotes/multi-channel` HB-056, `POST /quotes` HB-074) PHẢI nạp dữ kiện
 * qua đây rồi gọi `quotePrice` — không chép công thức và không tự tính giá ở tầng API/frontend
 * (BR-RATE-17). Hàm **chỉ đọc**: caller mở transaction và tự quyết định ghi (quote/snapshot) nếu cần.
 *
 * Nguồn dữ kiện: `02-nghiep-vu/dong-gia.md` §2, §4, §6, §7; `04-thiet-ke/csdl.md` §3
 * (`rate_calendars`, `seasons`, `channels`, `channel_property_settings`, `occupancy_snapshots`,
 * `promotions`, `rate_plans`, `room_types`).
 *
 * Quy ước:
 * - Một bộ dữ kiện dựng cho **đúng một loại phòng trên một khoảng ngày** (kỳ 1 đêm hợp lệ), không
 *   chọn kênh: caller ghép `{ ...facts, channelCode }` để chạy engine cho từng kênh.
 * - `ratePlan` trả trong facts mang `minNights`/`maxNights`/`losDiscountEnabled`/`depositPercent`.
 *   Khi không truyền `ratePlanCode`, dùng **gói giá mặc định** = gói `ACTIVE` gắn chính sách huỷ
 *   `cancellation_policies.is_default = true` (seed → `FLEX7`), dự phòng mã `FLEX7`; không có gói
 *   hợp lệ → `E_RATE_CONFIGURATION_INVALID`.
 * - Hệ số công suất/LOS/cuối tuần: ngưỡng đọc từ `system_settings` (`pricing.*`), còn các mức hệ số
 *   và thang LOS là hằng số nghiệp vụ của BR-RATE-01 bước 4/5 và `dong-gia.md` §4.4, §6.1.
 */
import type { Prisma } from '@prisma/client';
import type {
  CalendarRate,
  Channel,
  ChannelSetting,
  Occupancy,
  PricingInput,
  PricingSettings,
  Promotion,
  RatePlan,
  RoomRate,
  Season,
} from '@pinehill/domain/pricing';
import { rateSourceSchema, type RatePlanCode } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';

/** Đầu vào engine trừ `channelCode` (caller chọn kênh), nên ghép trực tiếp bằng spread. */
export type PricingFacts = Omit<PricingInput, 'channelCode'>;

export interface PricingFactsQuery {
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  /** Bỏ trống thì suy từ `room_types.property_id`; truyền vào để đối chiếu chủ sở hữu loại phòng. */
  readonly propertyId?: string;
  /** Bỏ trống thì dùng gói giá mặc định (xem docstring). */
  readonly ratePlanCode?: RatePlanCode;
  /** Mã khuyến mãi người gọi đã chọn; mặc định rỗng. */
  readonly promotionCodes?: readonly string[];
}

/** Thang ưu đãi dài ngày LOS — `dong-gia.md` §4.4 (3–6 đêm 0,95; 7–13 đêm 0,90; ≥ 14 đêm 0,85). */
export const LOS_LADDER: PricingSettings['los'] = [
  { minNights: 3, multiplier: '0.95' },
  { minNights: 7, multiplier: '0.90' },
  { minNights: 14, multiplier: '0.85' },
];

/** Hệ số công suất theo bậc — BR-RATE-01 bước 4, `dong-gia.md` §6.1 (hằng số, không cấu hình). */
export const OCCUPANCY_MID_MULTIPLIER = '1.15';
export const OCCUPANCY_HIGH_MULTIPLIER = '1.25';
/** Snapshot cũ hơn 5 phút coi như không có — BR-RATE-01 bước 4, `dong-gia.md` §6.1. */
export const OCCUPANCY_FRESHNESS_MS = 300_000;

const SETTING_KEYS = [
  'pricing.weekendMultiplier',
  'pricing.occupancyMidPct',
  'pricing.occupancyHighPct',
  'pricing.maxDiscountPct',
] as const;

/** Ngày VN `YYYY-MM-DD` từ cột `date`/`timestamptz` đã chuẩn hoá UTC (BR-GEN-05). */
const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);

function ratePlanData(row: {
  id: string;
  min_nights: number;
  max_nights: number;
  los_discount_enabled: boolean;
  deposit_percent: { toString(): string };
  fixed_nightly_price: bigint | null;
}): RatePlan {
  return {
    id: row.id,
    minNights: row.min_nights,
    maxNights: row.max_nights,
    losDiscountEnabled: row.los_discount_enabled,
    depositPercent: row.deposit_percent.toString(),
    ...(row.fixed_nightly_price === null
      ? {}
      : { fixedNightlyPrice: Number(row.fixed_nightly_price) }),
  };
}

function seasonData(row: {
  id: string;
  property_id: string | null;
  start_date: Date;
  end_date: Date;
  priority: number;
  created_at: Date;
  multiplier: { toString(): string };
  weekend_surcharge_enabled: boolean;
}): Season {
  return {
    id: row.id,
    ...(row.property_id === null ? {} : { propertyId: row.property_id }),
    from: dateOnly(row.start_date),
    to: dateOnly(row.end_date),
    priority: row.priority,
    createdAt: row.created_at.getTime(),
    multiplier: row.multiplier.toString(),
    weekendSurchargeEnabled: row.weekend_surcharge_enabled,
  };
}

function calendarData(row: {
  id: string;
  property_id: string;
  room_type_id: string;
  date: Date;
  channel_code: string | null;
  rate_plan_id: string | null;
  source: string;
  price: bigint;
  created_at: Date;
}): CalendarRate {
  return {
    id: row.id,
    propertyId: row.property_id,
    roomTypeId: row.room_type_id,
    from: dateOnly(row.date),
    to: dateOnly(row.date),
    ...(row.channel_code === null ? {} : { channelCode: row.channel_code }),
    ...(row.rate_plan_id === null ? {} : { ratePlanId: row.rate_plan_id }),
    source: rateSourceSchema.parse(row.source),
    price: Number(row.price),
    createdAt: row.created_at.getTime(),
  };
}

function channelData(row: {
  code: string;
  multiplier: { toString(): string };
  commission_pct: { toString(): string };
}): Channel {
  return {
    code: row.code,
    multiplier: row.multiplier.toString(),
    commissionPercent: row.commission_pct.toString(),
  };
}

function channelSettingData(row: {
  id: string;
  property_id: string;
  commission_pct: { toString(): string };
  multiplier_override: { toString(): string } | null;
  effective_from: Date;
  channels: { code: string };
}): ChannelSetting {
  return {
    id: row.id,
    propertyId: row.property_id,
    channelCode: row.channels.code,
    effectiveFrom: dateOnly(row.effective_from),
    ...(row.multiplier_override === null ? {} : { multiplier: row.multiplier_override.toString() }),
    commissionPercent: row.commission_pct.toString(),
  };
}

function occupancyData(row: {
  id: string;
  property_id: string;
  date: Date;
  sold_rooms: number;
  physical_rooms: number;
  captured_at: Date;
}): Occupancy {
  return {
    id: row.id,
    propertyId: row.property_id,
    date: dateOnly(row.date),
    demand: row.sold_rooms,
    supply: row.physical_rooms,
    capturedAt: row.captured_at.getTime(),
  };
}

function promotionData(row: {
  code: string;
  type: string;
  value: { toString(): string };
  stackable: boolean;
  valid_from: Date;
  valid_to: Date;
  used_count: number;
  max_uses: number | null;
}): Promotion {
  return {
    code: row.code,
    kind: row.type === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
    value: row.value.toString(),
    stackable: row.stackable,
    validFrom: Date.parse(`${dateOnly(row.valid_from)}T00:00:00.000Z`),
    // `valid_to` bao gồm cả ngày: cận trên độc quyền là nửa đêm ngày kế (engine dùng `now >= validTo`).
    validTo: Date.parse(`${dateOnly(row.valid_to)}T00:00:00.000Z`) + 86_400_000,
    uses: row.used_count,
    ...(row.max_uses === null ? {} : { maxUses: row.max_uses }),
  };
}

/** Ngưỡng/hệ số cấu hình được (`pricing.*`) + hằng số nghiệp vụ BR-RATE-01 bước 4/5 (`dong-gia.md` §6.1). */
function pricingSettings(configured: ReadonlyMap<string, string>): PricingSettings {
  return {
    weekendMultiplier: configured.get('pricing.weekendMultiplier') ?? '1.20',
    occupancyMidPercent: configured.get('pricing.occupancyMidPct') ?? '80',
    occupancyHighPercent: configured.get('pricing.occupancyHighPct') ?? '95',
    occupancyMidMultiplier: OCCUPANCY_MID_MULTIPLIER,
    occupancyHighMultiplier: OCCUPANCY_HIGH_MULTIPLIER,
    occupancyFreshnessMs: OCCUPANCY_FRESHNESS_MS,
    maxDiscountPercent: configured.get('pricing.maxDiscountPct') ?? '30',
    los: LOS_LADDER,
  };
}

/** Gói giá mặc định: gói `ACTIVE` gắn chính sách huỷ mặc định (BR-CANCEL-01), dự phòng `FLEX7`. */
function resolveRatePlan(tx: Prisma.TransactionClient, code?: RatePlanCode) {
  if (code !== undefined) return tx.rate_plans.findFirst({ where: { code, status: 'ACTIVE' } });
  return tx.rate_plans
    .findFirst({
      where: { status: 'ACTIVE', cancellation_policies: { is_default: true, status: 'ACTIVE' } },
      orderBy: { code: 'asc' },
    })
    .then(
      (plan) => plan ?? tx.rate_plans.findFirst({ where: { code: 'FLEX7', status: 'ACTIVE' } }),
    );
}

/**
 * Dựng dữ kiện giá cho một loại phòng trên một kỳ lưu trú (`checkOut` không bao gồm).
 *
 * @throws AppError `404 E_GEN_NOT_FOUND` khi không có loại phòng / gói giá yêu cầu.
 * @throws AppError `422 E_RATE_CONFIGURATION_INVALID` khi thiếu gói giá mặc định.
 */
export async function loadPricingFacts(
  tx: Prisma.TransactionClient,
  query: PricingFactsQuery,
): Promise<PricingFacts> {
  const start = new Date(`${query.checkIn}T00:00:00Z`);
  const end = new Date(`${query.checkOut}T00:00:00Z`);

  const room = await tx.room_types.findUnique({
    where: { id: query.roomTypeId },
    select: { id: true, property_id: true, base_price: true, min_price: true, max_price: true },
  });
  if (!room) throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
  if (query.propertyId && query.propertyId !== room.property_id)
    throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
  const propertyId = room.property_id;

  const plan = await resolveRatePlan(tx, query.ratePlanCode);
  if (!plan)
    throw new AppError(422, 'E_RATE_CONFIGURATION_INVALID', 'Cấu hình giá không đủ để báo giá.');

  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  const promotionCodes = query.promotionCodes ?? [];

  const [seasonRows, calendarRows, channelRows, settingRows, occupancyRows, promotionRows, config] =
    await Promise.all([
      tx.seasons.findMany({
        where: {
          status: 'ACTIVE',
          OR: [{ property_id: null }, { property_id: propertyId }],
          start_date: { lte: end },
          end_date: { gte: start },
        },
      }),
      tx.rate_calendars.findMany({
        where: { room_type_id: query.roomTypeId, date: { gte: start, lt: end } },
      }),
      tx.channels.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
      tx.channel_property_settings.findMany({
        where: { property_id: propertyId, effective_from: { lte: end } },
        include: { channels: { select: { code: true } } },
      }),
      tx.occupancy_snapshots.findMany({
        where: {
          property_id: propertyId,
          room_type_id: null,
          date: { gte: start, lt: end },
          captured_at: { lte: now },
        },
      }),
      promotionCodes.length > 0
        ? tx.promotions.findMany({
            where: { code: { in: [...new Set(promotionCodes)] }, status: 'ACTIVE' },
          })
        : Promise.resolve([]),
      tx.system_settings.findMany({
        where: { key: { in: [...SETTING_KEYS] } },
        select: { key: true, value: true },
      }),
    ]);

  const roomRate: RoomRate = {
    id: room.id,
    basePrice: Number(room.base_price),
    minPrice: Number(room.min_price),
    maxPrice: Number(room.max_price),
  };

  return {
    propertyId,
    room: roomRate,
    ratePlan: ratePlanData(plan),
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    now: now.getTime(),
    seasons: seasonRows.map(seasonData),
    calendar: calendarRows.map(calendarData),
    channels: channelRows.map(channelData),
    channelSettings: settingRows.map(channelSettingData),
    occupancy: occupancyRows.map(occupancyData),
    promotions: promotionRows.map(promotionData),
    settings: pricingSettings(new Map(config.map((row) => [row.key, row.value]))),
  };
}
