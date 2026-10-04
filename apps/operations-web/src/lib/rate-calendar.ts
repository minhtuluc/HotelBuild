/**
 * Lịch giá theo ngày (SCR-26, UC-RATE-01) — phần thuần, kiểm được bằng vitest.
 * Giao diện **không** tính giá và **không** suy mùa thắng: giá, nguồn và mùa hiển thị lấy nguyên
 * từ phản hồi `GET rate-calendar` (BR-RATE-02). Ở đây chỉ có luật của biểu mẫu: ngưỡng xác nhận
 * của OWNER (BR-RBAC-04), nhắc sàn–trần (BR-RATE-03/04) và cách gộp ngày thành lệnh ghi đè.
 */
import type { RateCalendarOverrideRequest } from '@pinehill/contracts';

/** Một ngày người dùng đang sửa: giá máy chủ đang hiển thị và giá vừa nhập. */
export interface RateEdit {
  date: string;
  currentPrice: number;
  nextPrice: number;
}

/** Một lệnh ghi đè: các ngày cùng một giá. Mỗi lệnh đi một request riêng (§ api.md 2.4). */
export interface OverrideOrder {
  price: number;
  dates: readonly string[];
  /** Lệnh này có ngày lệch quá ±20% so với giá hiện hành của chính ngày đó. */
  largeChange: boolean;
}

export interface EditPlan {
  readonly orders: readonly OverrideOrder[];
  readonly edited: readonly RateEdit[];
  readonly largeChange: boolean;
}

export type PriceWarning = 'belowFloor' | 'aboveCeiling';

/**
 * Lệch **quá** ±20% so với giá hiện hành của chính ngày đó (BR-RBAC-04) — tính bằng số nguyên
 * (`|mới − cũ| * 5 > cũ`) nên đúng biên ±20% vẫn chưa cần xác nhận, không dính sai số số thực.
 */
export function isLargeChange(currentPrice: number, nextPrice: number): boolean {
  return Math.abs(nextPrice - currentPrice) * 5 > currentPrice;
}

/** Ngoài `[sàn, trần]` — giao diện chỉ nhắc, máy chủ vẫn là nơi chặn (BR-RATE-03/04). */
export function priceWarning(
  nextPrice: number,
  minPrice: number,
  maxPrice: number,
): PriceWarning | null {
  if (nextPrice < minPrice) return 'belowFloor';
  if (nextPrice > maxPrice) return 'aboveCeiling';
  return null;
}

/** Gộp các ngày thành lệnh: ngày cùng giá đi chung, ngày không đổi giá bị bỏ qua. */
export function planOverrides(edits: readonly RateEdit[]): EditPlan {
  const byPrice = new Map<number, RateEdit[]>();
  const edited: RateEdit[] = [];
  for (const edit of edits) {
    if (edit.nextPrice === edit.currentPrice) continue;
    edited.push(edit);
    const group = byPrice.get(edit.nextPrice);
    if (group === undefined) byPrice.set(edit.nextPrice, [edit]);
    else group.push(edit);
  }
  return {
    orders: [...byPrice].map(([price, group]) => ({
      price,
      dates: group.map((edit) => edit.date),
      largeChange: group.some((edit) => isLargeChange(edit.currentPrice, price)),
    })),
    edited,
    largeChange: edited.some((edit) => isLargeChange(edit.currentPrice, edit.nextPrice)),
  };
}

export interface SubmitInput {
  edits: readonly RateEdit[];
  reason: string;
  confirmLarge: boolean;
  priority: string;
}

export interface SubmitCheck {
  ok: boolean;
  details: readonly { field: string; issue: string }[];
}

/** Ngày lệch quá ±20% chưa được xác nhận — nêu đích danh từng ngày trên biểu mẫu. */
function unconfirmedLargeDates(plan: EditPlan): readonly { field: string; issue: string }[] {
  const rows: { field: string; issue: string }[] = [];
  for (const order of plan.orders) {
    if (!order.largeChange) continue;
    for (const date of order.dates) {
      rows.push({ field: date, issue: 'LARGE_CHANGE_UNCONFIRMED' });
    }
  }
  return rows;
}

/**
 * Kiểm trước khi gửi: thiếu lý do, thiếu ưu tiên, không đổi ngày nào hoặc lệch quá ±20% mà chưa
 * tick xác nhận thì **chặn tại chỗ và không gọi API**. Giá ngoài sàn–trần **không** chặn ở đây —
 * giao diện chỉ nhắc, máy chủ quyết định (BR-RATE-03/04).
 */
export function validateSubmit(input: SubmitInput): SubmitCheck {
  const details: { field: string; issue: string }[] = [];
  const plan = planOverrides(input.edits);
  if (plan.edited.length === 0) details.push({ field: 'price', issue: 'NO_CHANGE' });
  if (input.reason.trim() === '') details.push({ field: 'reason', issue: 'REQUIRED' });
  const priority = Number(input.priority);
  if (input.priority.trim() === '' || !Number.isInteger(priority) || priority < 0) {
    details.push({ field: 'priority', issue: 'INVALID' });
  }
  if (plan.largeChange && !input.confirmLarge) details.push(...unconfirmedLargeDates(plan));
  return { ok: details.length === 0, details };
}

export interface OverrideOptions {
  priority: number;
  reason: string;
  confirmLarge: boolean;
}

/**
 * Thân một lệnh ghi đè. Cờ `confirmOwnerOverride` **chỉ** đặt `true` khi lệnh thật sự có ngày lệch
 * quá ±20% **và** người dùng đã tick; lệch trong ngưỡng thì bỏ hẳn trường. Không gửi `If-Match`:
 * lệnh sinh bản ghi giá mới (api.md §2.4).
 */
export function buildOverrideBody(
  order: OverrideOrder,
  options: OverrideOptions,
): RateCalendarOverrideRequest {
  const body: RateCalendarOverrideRequest = {
    items: order.dates.map((date) => ({ date, price: order.price })),
    priority: options.priority,
    reason: options.reason,
  };
  if (order.largeChange && options.confirmLarge) body.confirmOwnerOverride = true;
  return body;
}
