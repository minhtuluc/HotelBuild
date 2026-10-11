import { z } from 'zod';
import { invalid } from './support.js';
const id = z.uuid().transform((v) => v.toLowerCase());
const common = {
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: id.optional(),
};
export const propertyQuery = z.strictObject({
  ...common,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export const typeQuery = z.strictObject({ ...common, propertyId: id.optional() });
export const roomQuery = z.strictObject({
  ...common,
  propertyId: id.optional(),
  roomTypeId: id.optional(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']).optional(),
});
export type PageQuery = { limit: number; cursor?: string | undefined };
export function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success) throw invalid();
  return p.data;
}
export function page<T extends { id: string }, D>(
  rows: T[],
  total: number,
  q: PageQuery,
  project: (row: T) => D,
) {
  const selected = rows.slice(0, q.limit),
    hasMore = rows.length > q.limit;
  return {
    data: selected.map(project),
    meta: { total, limit: q.limit, hasMore, nextCursor: hasMore ? selected.at(-1)!.id : null },
  };
}
