/**
 * Nạp dữ kiện giá từ CSDL thành đầu vào engine HB-052. **Không** tính giá ở đây: mọi thứ số học
 * (thứ tự ưu tiên nguồn giá, chọn mùa thắng, hệ số cuối tuần/công suất/LOS/kênh, kẹp sàn–trần)
 * do `quotePrice`/`resolution` quyết định (BR-RATE-01…09, BR-RATE-19).
 *
 * Phạm vi của loader này là **một loại phòng trong một khoảng ngày** (màn SCR-26/SCR-27). Bản dùng
 * chung cho báo giá theo gói giá/kênh nằm ở `modules/rate/pricing-facts` (HB-056/HB-074) và có thể
 * tái dùng các hằng số + danh sách truy vấn ở đây.
 */
import type {
  Prisma,
  channel_property_settings,
  channels,
  occupancy_snapshots,
  rate_calendars,
  seasons,
} from '@prisma/client';
import { rateSourceSchema } from '@pinehill/contracts';
import type {
  CalendarRate,
  Channel,
  ChannelSetting,
  Occupancy,
  PricingInput,
  PricingSettings,
  RatePlan,
  RoomRate,
  Season,
} from '@pinehill/domain/pricing';
import { dateOnly } from './support.js';

/**
 * Gói giá trung tính cho lịch giá **theo loại phòng**: endpoint không nhận `ratePlanId` (api.md §2.4)
 * nên dòng `RATE_PLAN` (priority 90) không tham gia; `losDiscountEnabled=false` và LOS = 1,00 vì mức
 * giảm dài ngày phụ thuộc **cả kỳ** lưu trú, không phải thuộc tính của một đêm (BR-RATE-10). `id` là
 * UUID không thể trùng gói thật nên engine bỏ qua mọi dòng `RATE_PLAN`.
 */
export const CALENDAR_PLAN_ID = '00000000-0000-0000-0000-000000000000';
const CALENDAR_RATE_PLAN: RatePlan = Object.freeze({
  id: CALENDAR_PLAN_ID,
  minNights: 1,
  maxNights: 32767,
  losDiscountEnabled: false,
  depositPercent: '0',
});

/** Kênh tham chiếu khi lệnh không khai `channelCode`: giá niêm yết trực tiếp là mức màn hình hiển thị. */
export const WEB_CHANNEL = 'WEB';

/** BR-SYS-02: các khoá tham số giá đọc từ `SystemSetting` (HB-018 đã seed). */
const PRICING_SETTING_KEYS = [
  'pricing.weekendMultiplier',
  'pricing.occupancyMidPct',
  'pricing.occupancyHighPct',
  'pricing.maxDiscountPct',
] as const;

type PricingSettingKey = (typeof PRICING_SETTING_KEYS)[number];

const SETTING_DEFAULTS: Readonly<Record<PricingSettingKey, string>> = {
  'pricing.weekendMultiplier': '1.20',
  'pricing.occupancyMidPct': '80',
  'pricing.occupancyHighPct': '95',
  'pricing.maxDiscountPct': '30',
};

/**
 * Ba tham số engine cần nhưng HB-018 chưa có khoá `SystemSetting`, nên giữ hằng số đúng đặc tả
 * BR-RATE-01 §4.3 (hệ số công suất 1,15/1,25; snapshot cũ hơn 5 phút → 1,00) và §4.4 (bậc LOS).
 * Biến ba hằng này thành khoá cấu hình là việc của một migration seed, không phải ticket này.
 */
const OCCUPANCY_MID_MULTIPLIER = '1.15';
const OCCUPANCY_HIGH_MULTIPLIER = '1.25';
const OCCUPANCY_FRESHNESS_MS = 300_000;
const LOS_LADDER: PricingSettings['los'] = Object.freeze([
  { minNights: 3, multiplier: '0.95' },
  { minNights: 7, multiplier: '0.90' },
  { minNights: 14, multiplier: '0.85' },
]);

export interface PricingFactsQuery {
  readonly propertyId: string;
  readonly room: RoomRate;
  readonly checkIn: string;
  readonly checkOut: string;
  /** Bỏ trống = dùng kênh tham chiếu (WEB) như màn SCR-26 hiển thị. */
  readonly channelCode?: string;
}

export interface LoadedSeason {
  readonly id: string;
  readonly name: string;
  readonly propertyId: string | null;
  readonly from: string;
  readonly to: string;
  readonly priority: number;
}

export interface PricingFacts {
  readonly input: PricingInput;
  readonly seasons: readonly LoadedSeason[];
  /** BR-RATE-19: `LONGSTAY14` đang bán mà không có giá riêng (giá cố định hoặc dòng `RATE_PLAN`). */
  readonly longstayWithoutOwnPrice: boolean;
}

function settingValue(
  rows: readonly { key: string; value: string }[],
  key: PricingSettingKey,
): string {
  const raw = rows.find((row) => row.key === key)?.value?.trim();
  // Giá trị cấu hình hỏng không được làm sập lịch giá: rơi về mặc định đã nêu ở BR-SYS-02.
  return raw !== undefined && raw !== '' && Number.isFinite(Number(raw))
    ? raw
    : SETTING_DEFAULTS[key];
}

function pricingSettings(rows: readonly { key: string; value: string }[]): PricingSettings {
  return {
    weekendMultiplier: settingValue(rows, 'pricing.weekendMultiplier'),
    occupancyMidPercent: settingValue(rows, 'pricing.occupancyMidPct'),
    occupancyHighPercent: settingValue(rows, 'pricing.occupancyHighPct'),
    occupancyMidMultiplier: OCCUPANCY_MID_MULTIPLIER,
    occupancyHighMultiplier: OCCUPANCY_HIGH_MULTIPLIER,
    occupancyFreshnessMs: OCCUPANCY_FRESHNESS_MS,
    maxDiscountPercent: settingValue(rows, 'pricing.maxDiscountPct'),
    los: LOS_LADDER,
  };
}

function toSeason(row: seasons): Season {
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

function toCalendarRate(row: rate_calendars): CalendarRate {
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

function toChannel(row: channels): Channel {
  return {
    code: row.code,
    multiplier: row.multiplier.toString(),
    commissionPercent: row.commission_pct.toString(),
  };
}

type ChannelSettingRow = channel_property_settings & { channels: channels };

function toChannelSetting(row: ChannelSettingRow): ChannelSetting {
  return {
    id: row.id,
    propertyId: row.property_id,
    channelCode: row.channels.code,
    effectiveFrom: dateOnly(row.effective_from),
    ...(row.multiplier_override === null ? {} : { multiplier: row.multiplier_override.toString() }),
    commissionPercent: row.commission_pct.toString(),
  };
}

function toOccupancy(row: occupancy_snapshots): Occupancy {
  return {
    id: row.id,
    propertyId: row.property_id,
    date: dateOnly(row.date),
    demand: row.sold_rooms,
    supply: row.physical_rooms,
    capturedAt: row.captured_at.getTime(),
  };
}

/** Bỏ trống hoặc `query.channelCode` không có trong `channels` ⇒ lệnh không thể phân giải kênh. */
function resolveChannelCode(
  channelCodes: readonly string[],
  requested: string | undefined,
): string {
  if (requested !== undefined) {
    if (!channelCodes.includes(requested)) throw new Error('RATE_CALENDAR_UNKNOWN_CHANNEL');
    return requested;
  }
  if (channelCodes.length === 0) throw new Error('RATE_CALENDAR_CHANNELS_MISSING');
  return channelCodes.includes(WEB_CHANNEL) ? WEB_CHANNEL : channelCodes[0]!;
}

/** BR-RATE-19: gói dài ngày phải có `fixedNightlyPrice` hoặc ít nhất một dòng `RATE_PLAN`. */
async function longstayWithoutOwnPrice(tx: Prisma.TransactionClient): Promise<boolean> {
  const plan = await tx.rate_plans.findFirst({
    where: { code: 'LONGSTAY14', status: 'ACTIVE' },
    select: { id: true, fixed_nightly_price: true },
  });
  if (plan === null || plan.fixed_nightly_price !== null) return false;
  return (
    (await tx.rate_calendars.count({ where: { source: 'RATE_PLAN', rate_plan_id: plan.id } })) === 0
  );
}

export async function loadPricingFacts(
  tx: Prisma.TransactionClient,
  query: PricingFactsQuery,
): Promise<PricingFacts> {
  const start = new Date(`${query.checkIn}T00:00:00Z`),
    end = new Date(`${query.checkOut}T00:00:00Z`),
    range = { gte: start, lte: end };
  // Một mốc thời gian CSDL cho cả lần nạp: độ tươi snapshot công suất không bị chia cắt giữa các truy vấn.
  const nowRow = await tx.$queryRaw<
    { ms: bigint }[]
  >`SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS ms`;
  const now = Number(nowRow[0]!.ms);

  const channelRows = await tx.channels.findMany({ orderBy: { code: 'asc' } });
  const channelCode = resolveChannelCode(
    channelRows.map((row) => row.code),
    query.channelCode,
  );
  const seasonRows = await tx.seasons.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ property_id: query.propertyId }, { property_id: null }],
      start_date: { lte: end },
      end_date: { gte: start },
    },
    orderBy: { id: 'asc' },
  });
  const calendarRows = await tx.rate_calendars.findMany({
    where: { room_type_id: query.room.id, date: range },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const channelSettingRows = await tx.channel_property_settings.findMany({
    where: { property_id: query.propertyId },
    include: { channels: true },
    orderBy: { id: 'asc' },
  });
  // BR-INV-01: công suất là chỉ số **toàn cơ sở** → engine chỉ nhận snapshot `room_type_id IS NULL`.
  const occupancyRows = await tx.occupancy_snapshots.findMany({
    where: { property_id: query.propertyId, room_type_id: null, date: range },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const settingRows = await tx.system_settings.findMany({
    where: { key: { in: [...PRICING_SETTING_KEYS] } },
    select: { key: true, value: true },
  });
  const longstayWarning = await longstayWithoutOwnPrice(tx);

  return {
    input: {
      propertyId: query.propertyId,
      room: query.room,
      ratePlan: CALENDAR_RATE_PLAN,
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      channelCode,
      now,
      seasons: seasonRows.map(toSeason),
      calendar: calendarRows.map(toCalendarRate),
      channels: channelRows.map(toChannel),
      channelSettings: channelSettingRows.map(toChannelSetting),
      occupancy: occupancyRows.map(toOccupancy),
      // Lịch giá theo loại phòng không áp khuyến mãi: khuyến mãi là bước 10 của **báo giá** cả kỳ.
      promotions: [],
      settings: pricingSettings(settingRows),
    },
    seasons: seasonRows.map((row) => ({
      id: row.id,
      name: row.name,
      propertyId: row.property_id,
      from: dateOnly(row.start_date),
      to: dateOnly(row.end_date),
      priority: row.priority,
    })),
    longstayWithoutOwnPrice: longstayWarning,
  };
}
