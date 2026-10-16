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
 *   chọn kênh: caller ghép `{ ...facts, channelCode }` để chạy engine cho từng kênh. Ngoại lệ duy
 *   nhất là khi caller khai `promotionCodes`: phạm vi kênh của mã (`promotions.channel_scope`) chỉ
 *   kiểm được khi biết kênh nên hai trường đó phải đi cùng nhau (HB-199).
 * - `ratePlan` trả trong facts mang `minNights`/`maxNights`/`losDiscountEnabled`/`depositPercent`.
 *   Khi không truyền `ratePlanCode`, dùng **gói giá mặc định** = gói `ACTIVE` gắn chính sách huỷ
 *   `cancellation_policies.is_default = true` (seed → `FLEX7`), dự phòng mã `FLEX7`; không có gói
 *   hợp lệ → `E_RATE_CONFIGURATION_INVALID`. Truyền `ratePlanCode: null` khi bề mặt **không** nhận
 *   gói giá (lịch giá theo loại phòng, HB-198): facts mang `NEUTRAL_RATE_PLAN`, không truy vấn
 *   `rate_plans` và không đòi hỏi gói nào đang bán.
 * - `promotionCodes` người gọi chọn PHẢI có trong danh mục `promotions`: mã **không tồn tại** ⇒
 *   `422 E_RATE_PROMO_INVALID` (BR-RATE-14; api.md §3.1, §5). Mã có trong danh mục nhưng không dùng
 *   được (hết hạn, hết lượt, xếp chồng sai) do engine quyết — `quotePrice` trả `E_RATE_PROMOTION_INVALID`
 *   và bề mặt báo giá map thành cùng mã lỗi đó.
 * - HB-199: trước khi đưa mã vào dữ kiện, loader kiểm **phạm vi áp dụng** theo cột thật của
 *   `promotions` (csdl.md §3) — xem `promotionScopedTo`; mã **không áp được cho đầu vào** (sai kênh /
 *   sai loại phòng) là `422 E_RATE_PROMO_INVALID`, còn **chưa đủ `min_nights`** chỉ đơn giản không
 *   được áp (không lỗi). Cửa sổ `valid_from`/`valid_to` vẫn do engine thi hành.
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
import { rateSourceSchema, type ChannelCode, type RatePlanCode } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';

/**
 * Mùa kèm tên hiển thị. Engine chỉ đọc phần `Season`; bề mặt lịch giá cần tên mùa đang thắng
 * (hợp đồng HB-050 `seasonName`), nên loader trả luôn `seasons.name` thay vì để adapter truy vấn lại.
 */
export interface NamedSeason extends Season {
  readonly name: string;
}

/** Đầu vào engine trừ `channelCode` (caller chọn kênh), nên ghép trực tiếp bằng spread. */
export interface PricingFacts extends Omit<PricingInput, 'channelCode'> {
  readonly seasons: readonly NamedSeason[];
}

/** Truy vấn chung của mọi bề mặt báo giá (không phụ thuộc việc có khai mã khuyến mãi hay không). */
interface PricingFactsQueryBase {
  readonly roomTypeId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  /** Bỏ trống thì suy từ `room_types.property_id`; truyền vào để đối chiếu chủ sở hữu loại phòng. */
  readonly propertyId?: string;
  /**
   * Bỏ trống thì dùng gói giá mặc định (xem docstring); `null` = **không phân giải gói giá** ⇒
   * `ratePlan` là `NEUTRAL_RATE_PLAN`, dùng cho bề mặt không nhận gói giá (lịch giá theo loại phòng).
   */
  readonly ratePlanCode?: RatePlanCode | null;
}

/**
 * Truy vấn dữ kiện giá.
 *
 * Dữ kiện trả về **không** kênh (caller ghép `{ ...facts, channelCode }`), **trừ** khi khai
 * `promotionCodes`: lúc đó `channelCode` là **bắt buộc** để kiểm `promotions.channel_scope`. Union
 * dưới đây chặn ngay ở kiểu để không còn đường nạp mã mà không kiểm được kênh (HB-199).
 */
export type PricingFactsQuery = PricingFactsQueryBase &
  (
    | {
        /** Không khai mã khuyến mãi thì cũng không cần kênh. */
        readonly promotionCodes?: undefined;
        readonly channelCode?: ChannelCode;
      }
    | {
        /** Mã khuyến mãi người gọi đã chọn (xem docstring về mã không có trong danh mục). */
        readonly promotionCodes: readonly string[];
        /** Kênh của báo giá — bắt buộc khi có mã, vì phạm vi kênh của mã chỉ kiểm được khi biết kênh. */
        readonly channelCode: ChannelCode;
      }
  );

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

/**
 * Gói giá trung tính cho bề mặt **không** nhận gói giá (`ratePlanCode: null`, HB-198): `id` là UUID
 * không thể trùng gói thật nên engine bỏ qua mọi dòng lịch giá `RATE_PLAN`; `losDiscountEnabled=false`
 * (mức giảm dài ngày phụ thuộc **cả kỳ** lưu trú, không phải thuộc tính của một đêm — BR-RATE-10) và
 * không có `fixedNightlyPrice`.
 */
export const NEUTRAL_RATE_PLAN: RatePlan = Object.freeze({
  id: '00000000-0000-0000-0000-000000000000',
  minNights: 1,
  maxNights: 32767,
  losDiscountEnabled: false,
  depositPercent: '0',
});

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
  name: string;
  property_id: string | null;
  start_date: Date;
  end_date: Date;
  priority: number;
  created_at: Date;
  multiplier: { toString(): string };
  weekend_surcharge_enabled: boolean;
}): NamedSeason {
  return {
    id: row.id,
    name: row.name,
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
 * Mã khuyến mãi người gọi chọn PHẢI có trong **danh mục** `promotions` (mọi trạng thái); mã không tồn
 * tại ⇒ `422 E_RATE_PROMO_INVALID` (BR-RATE-14; api.md §3.1 và bảng mã lỗi §5).
 *
 * Chỉ gọi khi có mã không phân giải được ở truy vấn `status = 'ACTIVE'` (mã lạ, hoặc mã đang `INACTIVE`)
 * nên đường nạp bình thường không thêm round-trip. Mã đang `INACTIVE` **không** phải lỗi: nó có trong
 * danh mục nhưng không được áp — đúng cách đọc hẹp của đặc tả (chỉ mã không tồn tại mới bị từ chối).
 */
async function assertPromotionsInCatalogue(
  tx: Prisma.TransactionClient,
  codes: readonly string[],
): Promise<void> {
  if (codes.length === 0) return;
  const catalogue = await tx.promotions.findMany({
    where: { code: { in: [...codes] } },
    select: { code: true },
  });
  const known = new Set(catalogue.map((row) => row.code));
  if (codes.every((code) => known.has(code))) return;
  throw new AppError(422, 'E_RATE_PROMO_INVALID', 'Mã khuyến mãi không hợp lệ.');
}

/**
 * Lọc mã theo **phạm vi áp dụng** trước khi đưa vào dữ kiện cho engine (HB-199). Engine `Promotion`
 * của `packages/domain` không mang phạm vi nên đây là chỗ duy nhất chặn được "giảm giá sai".
 *
 * Cột thật của `promotions` (csdl.md §3) dùng ở đây: `min_nights`, `channel_scope`, `room_type_scope`.
 * `room_type_scope` chứa **mã loại phòng** chứ không phải UUID — `ck_promotions_room_types` chỉ cho
 * `STD/SUP/DLX/FAM/DOR`, khớp `room_types.code`. Cửa sổ `valid_from`/`valid_to` **không** lọc tại đây:
 * hai cột đó đã có trong `Promotion` của domain nên engine tự thi hành (`now` vs `validFrom`/`validTo`)
 * và trả `E_RATE_PROMOTION_INVALID`; lọc trước ở loader sẽ nuốt mất lỗi đã công bố (api.md §3.1).
 *
 * Cách đọc nhóm lỗi (api.md §3.1 + bảng mã lỗi §5 + BR-RATE-14; HB-061 AC5):
 * - **sai kênh / sai loại phòng** ⇒ `422 E_RATE_PROMO_INVALID`: §5 ghi nguyên văn nhóm nguyên nhân
 *   "hết hạn, hết lượt, sai kênh/loại phòng".
 * - **chưa đủ `min_nights`** ⇒ mã **không được áp**, không lỗi: không nguồn nào xếp số đêm tối thiểu
 *   vào nhóm lỗi, nên mã chỉ đơn giản là không đủ điều kiện (khác "mã không hợp lệ").
 *
 * `channel_scope`/`room_type_scope` rỗng = **không giới hạn**: DDL để mặc định `'{}'` (csdl.md §3) nên
 * dữ liệu cũ/seed chưa khai phạm vi vẫn dùng được cho mọi kênh/loại phòng.
 *
 * @throws AppError `400 E_GEN_VALIDATION_FAILED` khi có mã mà không khai `channelCode` (chỉ xảy ra với
 *   caller bỏ qua kiểu `PricingFactsQuery`).
 * @throws AppError `422 E_RATE_PROMO_INVALID` khi mã sai kênh hoặc sai loại phòng.
 */
function promotionScopedTo<
  T extends {
    code: string;
    min_nights: number;
    channel_scope: string[];
    room_type_scope: string[];
  },
>(
  rows: readonly T[],
  input: {
    readonly channelCode: ChannelCode | undefined;
    readonly roomCode: string;
    readonly nights: number;
  },
): T[] {
  if (rows.length === 0) return [];
  const { channelCode } = input;
  if (channelCode === undefined)
    throw new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Thiếu kênh để kiểm phạm vi mã khuyến mãi.');
  return rows.filter((row) => {
    if (row.channel_scope.length > 0 && !row.channel_scope.includes(channelCode))
      throw new AppError(422, 'E_RATE_PROMO_INVALID', 'Mã khuyến mãi không áp dụng cho kênh này.');
    if (row.room_type_scope.length > 0 && !row.room_type_scope.includes(input.roomCode))
      throw new AppError(
        422,
        'E_RATE_PROMO_INVALID',
        'Mã khuyến mãi không áp dụng cho loại phòng này.',
      );
    return row.min_nights <= input.nights;
  });
}

/**
 * Dựng dữ kiện giá cho một loại phòng trên một kỳ lưu trú (`checkOut` không bao gồm).
 *
 * @throws AppError `404 E_GEN_NOT_FOUND` khi không có loại phòng / gói giá yêu cầu.
 * @throws AppError `422 E_RATE_CONFIGURATION_INVALID` khi thiếu gói giá mặc định (trừ `ratePlanCode: null`).
 * @throws AppError `422 E_RATE_PROMO_INVALID` khi `promotionCodes` có mã không tồn tại trong danh mục,
 *   hoặc mã đang bán nhưng **sai kênh / sai loại phòng** (HB-199).
 * @throws AppError `400 E_GEN_VALIDATION_FAILED` khi khai `promotionCodes` mà thiếu `channelCode`.
 */
export async function loadPricingFacts(
  tx: Prisma.TransactionClient,
  query: PricingFactsQuery,
): Promise<PricingFacts> {
  const start = new Date(`${query.checkIn}T00:00:00Z`);
  const end = new Date(`${query.checkOut}T00:00:00Z`);
  /** Số đêm của kỳ (`checkOut` không tính) — dùng cho `promotions.min_nights`. */
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);

  const room = await tx.room_types.findUnique({
    where: { id: query.roomTypeId },
    select: {
      id: true,
      code: true,
      property_id: true,
      base_price: true,
      min_price: true,
      max_price: true,
    },
  });
  if (!room) throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
  if (query.propertyId && query.propertyId !== room.property_id)
    throw new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
  const propertyId = room.property_id;

  // `ratePlanCode: null` = bề mặt không nhận gói giá ⇒ gói trung tính, không truy vấn `rate_plans`.
  const plan = query.ratePlanCode === null ? null : await resolveRatePlan(tx, query.ratePlanCode);
  if (query.ratePlanCode !== null && !plan)
    throw new AppError(422, 'E_RATE_CONFIGURATION_INVALID', 'Cấu hình giá không đủ để báo giá.');

  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  const promotionCodes = [...new Set(query.promotionCodes ?? [])];

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
            where: { code: { in: promotionCodes }, status: 'ACTIVE' },
          })
        : Promise.resolve([]),
      tx.system_settings.findMany({
        where: { key: { in: [...SETTING_KEYS] } },
        select: { key: true, value: true },
      }),
    ]);

  // BR-RATE-14 + api.md §3.1/§5: mã người gọi chọn phải có trong danh mục `promotions`; mã **không tồn
  // tại** là lỗi người gọi (không phải "mã không được áp"); mã đang tắt chỉ đơn giản là không áp dụng.
  const resolvedCodes = new Set(promotionRows.map((row) => row.code));
  await assertPromotionsInCatalogue(
    tx,
    promotionCodes.filter((code) => !resolvedCodes.has(code)),
  );
  // HB-199: chỉ mã **áp được cho đúng đầu vào này** mới vào dữ kiện (phạm vi kênh/loại phòng/số đêm).
  const applicablePromotions = promotionScopedTo(promotionRows, {
    channelCode: query.channelCode,
    roomCode: room.code,
    nights,
  });

  const roomRate: RoomRate = {
    id: room.id,
    basePrice: Number(room.base_price),
    minPrice: Number(room.min_price),
    maxPrice: Number(room.max_price),
  };

  return {
    propertyId,
    room: roomRate,
    ratePlan: plan === null ? NEUTRAL_RATE_PLAN : ratePlanData(plan),
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    now: now.getTime(),
    seasons: seasonRows.map(seasonData),
    calendar: calendarRows.map(calendarData),
    channels: channelRows.map(channelData),
    channelSettings: settingRows.map(channelSettingData),
    occupancy: occupancyRows.map(occupancyData),
    promotions: applicablePromotions.map(promotionData),
    settings: pricingSettings(new Map(config.map((row) => [row.key, row.value]))),
  };
}

/**
 * BR-RATE-19: gói dài ngày `LONGSTAY14` đang bán nhưng **chưa có giá riêng** — không `fixed_nightly_price`
 * và không có dòng lịch giá `RATE_PLAN` nào gắn gói đó. Bề mặt lịch giá dùng để nhắc trên màn hình cấu
 * hình; các bề mặt báo giá không cảnh báo.
 *
 * Cố ý **không** gộp vào `loadPricingFacts`: loader chuẩn giữ nguyên tập truy vấn cho mọi bề mặt báo giá
 * (HB-198 AC3), nên helper đọc thêm này được export riêng cho adapter nào cần.
 */
export async function longstayWithoutOwnPrice(tx: Prisma.TransactionClient): Promise<boolean> {
  const plan = await tx.rate_plans.findFirst({
    where: { code: 'LONGSTAY14', status: 'ACTIVE' },
    select: { id: true, fixed_nightly_price: true },
  });
  if (plan === null || plan.fixed_nightly_price !== null) return false;
  return (
    (await tx.rate_calendars.count({ where: { source: 'RATE_PLAN', rate_plan_id: plan.id } })) === 0
  );
}
