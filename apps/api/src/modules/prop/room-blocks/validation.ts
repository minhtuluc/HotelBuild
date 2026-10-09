import { maskOperationalText } from './operational-text.js';
import { z } from 'zod';
import { businessDateSchema, roomBlockCreateRequestSchema } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
export const invalid = () => new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy khoá phòng.');
export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');
export const uuid = (value: unknown): string => {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw invalid();
  return result.data.toLowerCase();
};
export function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function createInput(value: unknown) {
  const result = roomBlockCreateRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  const input = { ...result.data, roomId: uuid(result.data.roomId) };
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate >= input.endDate)
    throw invalid();
  return {
    ...input,
    ...(input.note === undefined ? {} : { note: maskOperationalText(input.note) }),
  };
}
export function deleteReason(value: unknown): string {
  const result = z.string().trim().min(1).max(500).safeParse(value);
  if (!result.success) throw invalid();
  return maskOperationalText(result.data);
}
export const listInput = z.strictObject({
  propertyId: z.uuid().optional(),
  roomId: z.uuid().optional(),
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type BlockListQuery = z.infer<typeof listInput>;
