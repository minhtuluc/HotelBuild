import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Dữ liệu cấu hình không hợp lệ.');
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');
export const forbidden = () => new AppError(403, 'E_RBAC_FORBIDDEN', 'Không có quyền cấu hình.');
export const conflict = () => new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Dữ liệu đã thay đổi.');
export function uuid(value: unknown): string {
  const p = z.uuid().safeParse(value);
  if (!p.success) throw invalid();
  return p.data.toLowerCase();
}
export function actor(request: FastifyRequest): AuthorizedActor {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}
export function numeric(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('PROP_VERSION_UNREPRESENTABLE');
  return n;
}
export function expected(value: unknown): bigint {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match để cập nhật.');
  if (typeof value !== 'string' || !/^"[1-9]\d{0,15}"$/.test(value)) throw conflict();
  const n = BigInt(value.slice(1, -1));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw conflict();
  return n;
}
