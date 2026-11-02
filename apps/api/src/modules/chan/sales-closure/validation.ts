import { salesClosureRequestSchema } from '@pinehill/contracts';
import { invalid } from '../../sys/settings/validation.js';

/** Trần một lệnh đóng bán: giữ lệnh có biên, tránh ghi hàng nghìn đêm trong một transaction. */
export const MAX_CLOSURE_DAYS = 366;

/** Lệnh đóng/mở bán đã chuẩn hoá — `closed` mặc định **true** (giữ hành vi đã phát hành, HB-120 AC14). */
export interface ClosureInput {
  readonly roomTypeId: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly closed: boolean;
}

function dayTimestamp(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** `[from,to)` theo ngày nghiệp vụ; `to` không trước `from` đã do schema chốt. */
export function closureDates(from: string, to: string): readonly string[] {
  const start = dayTimestamp(from);
  const end = dayTimestamp(to);
  const dates: string[] = [];
  for (let stamp = start; stamp < end; stamp += 86_400_000)
    dates.push(new Date(stamp).toISOString().slice(0, 10));
  return dates;
}

export function closureInput(value: unknown): ClosureInput {
  const parsed = salesClosureRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const days = (dayTimestamp(parsed.data.to) - dayTimestamp(parsed.data.from)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0 || days > MAX_CLOSURE_DAYS) throw invalid();
  return {
    roomTypeId: parsed.data.roomTypeId.toLowerCase(),
    from: parsed.data.from,
    to: parsed.data.to,
    reason: parsed.data.reason,
    closed: parsed.data.closed,
  };
}
