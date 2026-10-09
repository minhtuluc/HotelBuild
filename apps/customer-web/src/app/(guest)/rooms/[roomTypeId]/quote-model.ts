/**
 * SCR-03 — phần thuần: trạng thái hết hạn của báo giá và cờ chạm sàn/trần theo từng đêm.
 * Báo giá do máy chủ trả; màn hình chỉ đọc `expiresAt` và `clamped` (BR-RATE-17, api.md §3.1).
 */
import type { Quote, QuoteNight } from '@pinehill/contracts';

/** Báo giá đã hết hạn theo `expiresAt` máy chủ trả (AC2). */
export function isExpired(expiresAt: string, nowMs: number): boolean {
  const deadline = Date.parse(expiresAt);
  return Number.isNaN(deadline) ? false : deadline <= nowMs;
}

export interface NightRow {
  readonly date: string;
  readonly nightlyPrice: number;
  readonly basePrice: number;
  /** `true` khi tổng hệ số bị kẹp ở sàn/trần giá (máy chủ trả `clamped`). */
  readonly clamped: boolean;
}

/** Hàng bảng giá từng đêm — chép **nguyên** số máy chủ trả, không nhân hệ số lại. */
export function nightRows(quote: Quote): readonly NightRow[] {
  return quote.nights.map((night: QuoteNight) => ({
    date: night.date,
    nightlyPrice: night.nightlyPrice,
    basePrice: night.basePrice,
    clamped: night.clamped,
  }));
}

/** Ngày chạm sàn/trần — dùng cho cảnh báo tổng hợp (AC1). */
export function clampedDates(quote: Quote): readonly string[] {
  return quote.nights.filter((night) => night.clamped).map((night) => night.date);
}
