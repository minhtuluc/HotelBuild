/**
 * Chuẩn hoá query của tuyến đọc ca quá tải (HB-126; api.md §3.9, §1.5).
 *
 * `limit` 1..100 (vượt trần ⇒ `400 E_GEN_VALIDATION_FAILED`); cursor là `(date, id)` mã hoá base64url
 * nên không chứa thông tin cấp quyền. `overdueOnly` chỉ nhận đúng `true`/`false`.
 */
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const caseQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  propertyId: z.uuid().optional(),
  status: z.enum(['OPEN', 'PROPOSED', 'RESOLVED', 'ESCALATED']).optional(),
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
  roomTypeId: z.uuid().optional(),
  overdueOnly: booleanFlag,
});

const detailQuerySchema = z.strictObject({
  includeCandidates: booleanFlag,
});

const alertQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  propertyId: z.uuid().optional(),
  date: dateOnly.optional(),
  overdueOnly: booleanFlag,
});

export interface CaseCursor {
  readonly date: string;
  readonly id: string;
}

export type CaseQuery = z.infer<typeof caseQuerySchema>;
export type DetailQuery = z.infer<typeof detailQuerySchema>;
export type AlertQuery = z.infer<typeof alertQuerySchema>;

function invalidQuery(): AppError {
  return new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Tham số truy vấn không hợp lệ.');
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidQuery();
  return result.data;
}

export function caseQuery(value: unknown): CaseQuery {
  return parse(caseQuerySchema, value);
}

export function detailQuery(value: unknown): DetailQuery {
  return parse(detailQuerySchema, value);
}

export function alertQuery(value: unknown): AlertQuery {
  return parse(alertQuerySchema, value);
}

export function encodeCursor(cursor: CaseCursor): string {
  return Buffer.from(`${cursor.date}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string): CaseCursor {
  const text = Buffer.from(value, 'base64url').toString('utf8');
  const separator = text.indexOf('|');
  const date = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (separator < 0 || !dateOnly.safeParse(date).success || !z.uuid().safeParse(id).success)
    throw invalidQuery();
  return { date, id };
}
