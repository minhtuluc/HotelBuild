import { z } from 'zod';
import { systemSettingUpdateRequestSchema } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { safeAuditText } from '../audit-logs/safe-text.js';
import { exactInteger, integralSetting } from './exact-number.js';
import { invalid } from './validation.js';
export const conflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Tham số đã thay đổi; hãy tải lại.');
export function key(value: unknown): string {
  const result = z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,128}$/)
    .safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}
export function input(value: unknown) {
  const result = systemSettingUpdateRequestSchema.safeParse(value);
  if (!result.success || !result.data.reason.trim()) throw invalid();
  return {
    value: result.data.value,
    reason: safeAuditText(result.data.reason.trim()).slice(0, 500),
  };
}
export function expectedVersion(value: unknown): bigint {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match để cập nhật.');
  if (typeof value !== 'string' || !/^"[1-9]\d{0,15}"$/.test(value)) throw conflict();
  const version = BigInt(value.slice(1, -1));
  if (version > BigInt(Number.MAX_SAFE_INTEGER)) throw conflict();
  return version;
}
export function typedValue(value: string, type: string, name: string): void {
  const rules: Readonly<Record<string, (value: string) => boolean>> = {
    STRING: (s) => s.length > 0,
    BOOLEAN: (s) => s === 'true' || s === 'false',
    JSON: validJson,
    NUMBER: validNumber,
  };
  if (!rules[type]?.(value)) throw invalid();
  if (type !== 'NUMBER') return;
  if (integralSetting(name) && exactInteger(value) === null) throw invalid();
  if (!numericBound(name, Number(value))) throw invalid();
}
function validJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
function validNumber(value: string): boolean {
  return (
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) &&
    Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER
  );
}
const integralRange = (value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const numericRules: Readonly<Record<string, (value: number) => boolean>> = {
  'pricing.weekendMultiplier': (value) => value > 0,
  'pricing.maxDiscountPct': (value) => integralRange(value, 0, 30),
  checkInDebtPct: (value) => integralRange(value, 0, 100),
  'deal.threshold.checkInDebtPct': (value) => integralRange(value, 0, 100),
  'refund.feeAmount': (value) => integralRange(value, 0),
  'overbooking.transportSupportCap': (value) => integralRange(value, 0),
  'channel.lowInventoryThreshold': (value) => integralRange(value, 0),
};
function numericBound(name: string, value: number): boolean {
  const rule = numericRules[name];
  if (rule) return rule(value);
  if (name.startsWith('job.')) return integralRange(value, 1);
  if (name.startsWith('deal.threshold.')) return integralRange(value, 0);
  return true;
}
