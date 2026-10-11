import { z } from 'zod';
import {
  housekeepingTaskQuerySchema,
  housekeepingTaskUpdateRequestSchema,
} from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { FastifyRequest } from 'fastify';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thao tác nhiệm vụ này.');
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy nhiệm vụ.');
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu nhiệm vụ không hợp lệ.');
export const conflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Nhiệm vụ đã thay đổi; hãy tải lại.');
const uuidSchema = z.uuid().transform((s) => s.toLowerCase());
const querySchema = housekeepingTaskQuerySchema.extend({
  propertyId: uuidSchema.optional(),
  assignedTo: uuidSchema.optional(),
  cursor: uuidSchema.optional(),
});
const updateSchema = housekeepingTaskUpdateRequestSchema.extend({
  assignedTo: uuidSchema.nullable().optional(),
});
export type Query = z.infer<typeof querySchema>;
export type Update = z.infer<typeof updateSchema>;
export function taskId(value: unknown) {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}
export function readQuery(value: unknown): Query {
  const result = querySchema.safeParse(value);
  if (!result.success) throw invalid();
  const { businessDate } = result.data;
  const day = new Date(`${businessDate}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== businessDate)
    throw invalid();
  return result.data;
}
export function updateInput(value: unknown): Update {
  const result = updateSchema.safeParse(value);
  if (!result.success) throw invalid();
  const input = result.data;
  if (input.status === undefined && input.note === undefined && input.assignedTo === undefined)
    throw invalid();
  return {
    ...input,
    ...(input.note === undefined ? {} : { note: maskOperationalText(input.note) }),
    ...(input.reason === undefined ? {} : { reason: maskOperationalText(input.reason) }),
  };
}
export function expectedVersion(value: unknown): bigint {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match để cập nhật.');
  if (typeof value !== 'string' || !/^"[1-9]\d{0,15}"$/.test(value)) throw conflict();
  const result = BigInt(value.slice(1, -1));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw conflict();
  return result;
}
export function requestActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}
