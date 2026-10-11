import { z } from 'zod';
import { allotmentPutRequestSchema, allotmentQuerySchema } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
export const invalid = () => new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy cấu hình tồn.');
export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');
export function uuid(value: string): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw invalid();
  return result.data.toLowerCase();
}
export function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !value.startsWith('0000-') &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function nextDate(value: string): string {
  const next = new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  if (!validDate(next)) throw invalid();
  return next;
}
export function validateRange(from: string, to: string): void {
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 30 * 86400000
  )
    throw invalid();
  nextDate(to);
}
export function readInput(value: unknown) {
  const result = allotmentQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  validateRange(result.data.from, result.data.to);
  return {
    ...result.data,
    channelId: uuid(result.data.channelId),
    roomTypeId: uuid(result.data.roomTypeId),
  };
}
export function writeInput(value: unknown) {
  const result = allotmentPutRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  const input = result.data;
  if (
    input.items.some((item) => !validDate(item.date)) ||
    new Set(input.items.map((item) => item.date)).size !== input.items.length
  )
    throw invalid();
  return {
    ...input,
    channelId: uuid(input.channelId),
    roomTypeId: uuid(input.roomTypeId),
    reason: input.reason === undefined ? null : maskOperationalText(input.reason),
  };
}
export type ReadInput = ReturnType<typeof readInput>;
export type WriteInput = ReturnType<typeof writeInput>;
