/**
 * Kiểm đầu vào lịch giá (UC-RATE-01). Ngưỡng ±20% và sàn–trần nằm ở đây; bản thân con số giá do engine
 * `@pinehill/domain/pricing` quyết định (BR-RATE-01…04, BR-RBAC-04).
 */
import {
  rateCalendarOverrideRequestSchema,
  rateCalendarQuerySchema,
  rateSourceSchema,
} from '@pinehill/contracts';
import type { z } from 'zod';
import {
  civilDay,
  configuration,
  configurationAll,
  invalid,
  isCivilDate,
  maskText,
  uuid,
} from './support.js';
import type { Issue } from './support.js';

/** Lịch giá theo loại phòng chỉ phục vụ màn hình cấu hình; một năm là quá đủ cho một lần xem. */
const MAX_RANGE_DAYS = 366;

export type RateSource = z.infer<typeof rateSourceSchema>;

export interface CalendarQuery {
  readonly roomTypeId: string;
  readonly from: string;
  readonly to: string;
  readonly source?: RateSource;
}

export function calendarQuery(roomTypeId: unknown, query: unknown): CalendarQuery {
  const parsed = rateCalendarQuerySchema.safeParse(query);
  if (!parsed.success) throw invalid();
  const span = civilDay(parsed.data.to) - civilDay(parsed.data.from);
  if (span < 0 || span + 1 > MAX_RANGE_DAYS) throw invalid();
  return {
    roomTypeId: uuid(roomTypeId),
    from: parsed.data.from,
    to: parsed.data.to,
    ...(parsed.data.source === undefined ? {} : { source: parsed.data.source }),
  };
}

export interface OverrideItem {
  readonly date: string;
  readonly price: number;
}

export interface OverrideInput {
  readonly roomTypeId: string;
  readonly items: readonly OverrideItem[];
  /** Bỏ trống = ghi đè cho **mọi kênh** (`channel_code IS NULL`, BR-RATE-02). */
  readonly channelCode?: string;
  readonly reason: string;
  readonly confirmOwnerOverride: boolean;
}

/**
 * `priority` trong thân lệnh chỉ giữ cho tương thích hợp đồng đã phát hành: `ck_rate_calendars_priority`
 * buộc dòng `OVERRIDE` phải là 100 — đúng "priority cao nhất" của api.md §2.4 và BR-RATE-02 — nên máy
 * chủ luôn ghi 100 thay vì tin giá trị client gửi (màn SCR-26 để mặc định 0).
 */
export function overrideInput(roomTypeId: unknown, value: unknown): OverrideInput {
  const parsed = rateCalendarOverrideRequestSchema.safeParse(value);
  if (!parsed.success)
    configuration(parsed.error.issues[0]?.path.join('.') || 'request', 'INVALID_VALUE');
  const issues: Issue[] = [],
    seen = new Set<string>();
  for (const [index, item] of parsed.data.items.entries()) {
    if (!isCivilDate(item.date))
      issues.push({ field: `items[${index}].date`, issue: 'INVALID_DATE' });
    if (seen.has(item.date))
      issues.push({ field: `items[${index}].date`, issue: 'DUPLICATE_DATE' });
    seen.add(item.date);
  }
  if (issues.length > 0) configurationAll(issues);
  const reason = parsed.data.reason.trim();
  if (reason === '') configuration('reason', 'REQUIRED');
  return {
    roomTypeId: uuid(roomTypeId),
    items: parsed.data.items.map((item) => ({ date: item.date, price: item.price })),
    ...(parsed.data.channelCode === undefined ? {} : { channelCode: parsed.data.channelCode }),
    reason: maskText(reason),
    confirmOwnerOverride: parsed.data.confirmOwnerOverride === true,
  };
}

/** BR-RATE-03/04: giá ghi đè vẫn phải nằm trong `[RoomType.minPrice, RoomType.maxPrice]`. */
export function priceIssues(
  items: readonly OverrideItem[],
  bounds: { readonly minPrice: number; readonly maxPrice: number },
): readonly Issue[] {
  return items.flatMap((item, index) =>
    item.price < bounds.minPrice
      ? [{ field: `items[${index}].price`, issue: 'BELOW_FLOOR' }]
      : item.price > bounds.maxPrice
        ? [{ field: `items[${index}].price`, issue: 'ABOVE_CEILING' }]
        : [],
  );
}

/**
 * BR-RBAC-04 / TC-AUTH-09: lệch **quá** ±20% so với giá hiện hành của chính ngày đó — tức
 * `nightlyPrice` mà `GET rate-calendar` trả cho cùng phạm vi kênh (HB-058 ghi rõ: không tính trên giá
 * cơ bản của loại phòng). Số nguyên nên đúng biên ±20% vẫn lưu bình thường; công thức này trùng
 * `isLargeChange` của màn SCR-26 để giao diện và máy chủ không lệch nhau.
 */
export function largeChange(currentPrice: number, nextPrice: number): boolean {
  return Math.abs(nextPrice - currentPrice) * 5 > currentPrice;
}
