/**
 * Chiếu kết quả engine HB-052 sang hợp đồng HB-050: mỗi đêm của `quotePrice` thành một phần tử
 * `rateCalendarSchema.entries`, kèm `source` (nguồn giá đang thắng) và `seasonName` (mùa đang thắng).
 * Giao diện **không** tự suy hai trường này (BR-RATE-02, HB-058 AC2).
 */
import { rateCalendarSchema } from '@pinehill/contracts';
import type { RateCalendar } from '@pinehill/contracts';
import type { CalendarSource, Fraction, NightPrice } from '@pinehill/domain/pricing';
import type { PricingFacts } from './facts.js';

export type RateCalendarEntry = RateCalendar['entries'][number];

const MAX_WARNINGS = 20;
const MULTIPLIER_SCALE = 1e6;

/** Engine trả phân số chính xác; hệ số JSON đi qua phép chia này, tiền thì không. */
function stepRatio(part: Fraction, whole: Fraction): number {
  const numerator = BigInt(part.numerator) * BigInt(whole.denominator),
    denominator = BigInt(part.denominator) * BigInt(whole.numerator);
  if (denominator === 0n) throw new Error('RATE_CALENDAR_ZERO_MULTIPLIER');
  return (
    Math.round((Number(numerator) / Number(denominator)) * MULTIPLIER_SCALE) / MULTIPLIER_SCALE
  );
}

export function calendarEntry(
  night: NightPrice,
  seasonName: string | undefined,
): RateCalendarEntry {
  return {
    date: night.date,
    basePrice: Number(night.base.numerator) / Number(night.base.denominator),
    seasonMultiplier: stepRatio(night.p1, night.base),
    weekendMultiplier: stepRatio(night.p2, night.p1),
    occupancyMultiplier: stepRatio(night.p3, night.p2),
    losMultiplier: stepRatio(night.p4, night.p3),
    channelMultiplier: stepRatio(night.p5, night.p4),
    clamped: night.clamped !== null,
    nightlyPrice: night.nightlyPrice,
    // Không dòng lịch giá nào khớp ⇒ engine trả `ROOM_TYPE`; hợp đồng chỉ có BASE/SEASON/OVERRIDE/RATE_PLAN
    // nên ngày đó được báo là nguồn BASE với `basePrice` = giá cơ bản của loại phòng (BR-RATE-02,03).
    source: night.baseSource === 'ROOM_TYPE' ? 'BASE' : (night.baseSource satisfies CalendarSource),
    ...(seasonName === undefined ? {} : { seasonName }),
  };
}

/**
 * Cảnh báo nghiệp vụ của máy chủ. BR-RATE-19 (`LONGSTAY14` chưa có giá riêng) và BR-RATE-05 (hai mùa
 * chồng nhau cùng `priority` — vẫn được phép lưu nhưng màn hình cấu hình phải nhắc).
 */
export function calendarWarnings(
  facts: PricingFacts,
  range: { readonly from: string; readonly to: string },
): string[] {
  const warnings: string[] = [];
  if (facts.longstayWithoutOwnPrice)
    warnings.push(
      'LONGSTAY14 chưa có giá riêng — đang bằng giá FLEX7; hãy cấu hình giá cố định hoặc dòng RATE_PLAN (BR-RATE-19)',
    );
  for (const [index, a] of facts.seasons.entries())
    for (const b of facts.seasons.slice(index + 1)) {
      if (a.priority !== b.priority) continue;
      const from = a.from > b.from ? a.from : b.from,
        to = a.to < b.to ? a.to : b.to;
      if (from > to || to < range.from || from > range.to) continue;
      warnings.push(
        `Mùa “${a.name}” và “${b.name}” chồng lấn cùng priority ${a.priority} trong kỳ đang xem — xếp hạng chỉ còn theo khoảng hẹp hơn rồi createdAt (BR-RATE-05)`,
      );
    }
  return warnings.slice(0, MAX_WARNINGS);
}

export function calendarResponse(value: {
  readonly roomTypeId: string;
  readonly from: string;
  readonly to: string;
  readonly entries: readonly RateCalendarEntry[];
  readonly warnings: readonly string[];
}): RateCalendar {
  return rateCalendarSchema.parse({
    roomTypeId: value.roomTypeId,
    from: value.from,
    to: value.to,
    entries: [...value.entries],
    ...(value.warnings.length === 0 ? {} : { warnings: [...value.warnings] }),
  });
}

interface OverrideRow {
  readonly id: string;
  readonly date: Date;
  readonly price: bigint;
  readonly source: string;
  readonly channel_code: string | null;
  readonly priority: number;
}

/** Ảnh chụp dòng ghi đè cho `audit_logs.before_json`/`after_json` (đủ dữ liệu để hoàn nguyên). */
export function overrideSnapshot(
  roomTypeId: string,
  channelCode: string | null,
  rows: readonly OverrideRow[],
) {
  return {
    roomTypeId,
    channelCode,
    overrides: rows.map((row) => ({
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      price: row.price.toString(),
      source: row.source,
      channelCode: row.channel_code,
      priority: row.priority,
    })),
  };
}
