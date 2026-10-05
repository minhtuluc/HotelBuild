import type { CheckOutFeeInput } from './index.js';

function nonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function date(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
export function validInput(input: CheckOutFeeInput): boolean {
  return (
    date(input.checkOutDate) &&
    date(input.localNow.date) &&
    input.localNow.timeZone === 'Asia/Ho_Chi_Minh' &&
    nonnegativeInteger(input.localNow.millisecondsSinceMidnight) &&
    input.localNow.millisecondsSinceMidnight < 86_400_000 &&
    nonnegativeInteger(input.lastNightAmount)
  );
}
