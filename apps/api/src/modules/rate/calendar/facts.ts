/**
 * Adapter dữ kiện giá cho **lịch giá theo loại phòng** (HB-054, SCR-26/SCR-27) trên nền loader dùng
 * chung `modules/rate/pricing-facts` (HB-056/HB-074) — HB-198.
 *
 * Mọi dữ kiện giá đến từ **một** nguồn (`loadPricingFacts` của `pricing-facts`), nên lịch giá và báo
 * giá luôn cùng đầu vào (BR-RATE-17, ADR-015). File này **không** truy vấn CSDL và **không** ánh xạ
 * dòng CSDL; nó chỉ:
 * - thay gói giá bằng gói trung tính để dòng `RATE_PLAN` (priority 90) không tham gia lịch giá theo
 *   loại phòng (api.md §2.4 không nhận `ratePlanId`),
 * - chọn kênh tham chiếu khi lệnh không khai `channelCode` (WEB như màn SCR-26 hiển thị),
 * - mang thêm phần riêng của màn hình lịch giá: tên mùa đang thắng (`seasonName`) và cờ cảnh báo
 *   BR-RATE-19 (đọc qua helper export từ `pricing-facts`).
 *
 * Không tính giá ở đây: mọi thứ số học (thứ tự ưu tiên nguồn giá, chọn mùa thắng, hệ số cuối
 * tuần/công suất/LOS/kênh, kẹp sàn–trần) do `quotePrice`/`resolution` quyết định (BR-RATE-01…09, 19).
 */
import type { Prisma } from '@prisma/client';
import type { PricingInput, RatePlan, RoomRate } from '@pinehill/domain/pricing';
import {
  loadPricingFacts as loadSharedPricingFacts,
  longstayWithoutOwnPrice,
} from '../pricing-facts/index.js';

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

/**
 * Dữ kiện giá của một loại phòng trên một khoảng ngày: dựng bằng loader dùng chung rồi thích ứng cho
 * lịch giá (gói giá trung tính + kênh tham chiếu + tên mùa + cảnh báo BR-RATE-19).
 */
export async function loadPricingFacts(
  tx: Prisma.TransactionClient,
  query: PricingFactsQuery,
): Promise<PricingFacts> {
  const facts = await loadSharedPricingFacts(tx, {
    propertyId: query.propertyId,
    roomTypeId: query.room.id,
    checkIn: query.checkIn,
    checkOut: query.checkOut,
  });
  const channelCode = resolveChannelCode(
    facts.channels.map((channel) => channel.code),
    query.channelCode,
  );
  return {
    input: { ...facts, ratePlan: CALENDAR_RATE_PLAN, channelCode },
    seasons: facts.seasons.map((season) => ({
      id: season.id,
      name: season.name,
      propertyId: season.propertyId ?? null,
      from: season.from,
      to: season.to,
      priority: season.priority,
    })),
    longstayWithoutOwnPrice: await longstayWithoutOwnPrice(tx),
  };
}
