import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor, type AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy cấu hình.');
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu cấu hình không hợp lệ.');
export const conflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Cấu hình đã thay đổi; hãy tải phiên bản mới.');
export function configuration(field: string, issue: string): never {
  throw new AppError(422, 'E_RATE_CONFIGURATION_INVALID', 'Cấu hình không hợp lệ.', undefined, [
    { field, issue },
  ]);
}
export function uuid(value: unknown): string {
  const p = z.uuid().safeParse(value);
  if (!p.success) throw invalid();
  return p.data.toLowerCase();
}
export function paramId(params: unknown, name: 'ratePlanId' | 'policyId'): string {
  const p = z.record(z.string(), z.unknown()).safeParse(params);
  if (!p.success) throw invalid();
  return uuid(p.data[name]);
}
export function owner(actor: AuthorizedActor): AuthorizedActor {
  if (actor.role !== 'OWNER')
    throw new AppError(403, 'E_RBAC_FORBIDDEN', 'Không có quyền sửa cấu hình.');
  return actor;
}
export function requestOwner(request: FastifyRequest): AuthorizedActor {
  if (!isAuthorizedActor(request.actor))
    throw new AppError(403, 'E_RBAC_FORBIDDEN', 'Không có quyền cấu hình.');
  return owner(request.actor);
}
export function expectedVersion(value: unknown): bigint {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match để cập nhật.');
  if (typeof value !== 'string' || !/^"\d{1,19}"$/.test(value)) throw conflict();
  return BigInt(value.slice(1, -1));
}
export function numericVersion(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('CONFIGURATION_VERSION_UNREPRESENTABLE');
  return n;
}
export function maskText(value: string): string {
  return value
    .replace(
      /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/gu,
      (m) => `****${m.slice(-4)}`,
    )
    .replace(/\+?\d[\d\s().-]*\d/gu, (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 9 ? `****${digits.slice(-4)}` : m;
    });
}
export function reason(value: string): string {
  if (!value.trim()) throw invalid();
  return maskText(value.trim());
}
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .uuid()
    .transform((v) => v.toLowerCase())
    .optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;
export function page<T extends { id: string }, D>(
  rows: readonly T[],
  total: number,
  query: PageQuery,
  project: (row: T) => D,
) {
  const selected = rows.slice(0, query.limit),
    hasMore = rows.length > query.limit;
  return {
    data: selected.map(project),
    meta: { total, limit: query.limit, hasMore, nextCursor: hasMore ? selected.at(-1)!.id : null },
  };
}
export function safeDatabaseError(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new Error('RATE_CONFIGURATION_DATABASE_FAILURE');
}
export async function recordChange(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  clock: Clock,
  ids: IdGenerator,
  entityType: 'RatePlan' | 'CancellationPolicy',
  before: Prisma.InputJsonObject,
  after: Prisma.InputJsonObject,
  why: string,
) {
  const id = String(after.id),
    version = Number(after.version);
  await new AuditWriter(clock).record(tx, {
    actor,
    entityType,
    entityId: id,
    action: entityType === 'RatePlan' ? 'RATE_PLAN_UPDATED' : 'CANCELLATION_POLICY_UPDATED',
    beforeJson: before,
    afterJson: after,
    reason: why,
  });
  await tx.outbox_events.create({
    data: {
      id: ids.generate(),
      event_type: 'RateChanged',
      aggregate_type: entityType,
      aggregate_id: id,
      payload_json: { schemaVersion: 1, entityType, entityId: id, version },
    },
  });
}
