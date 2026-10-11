import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { FastifyRequest } from 'fastify';
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu hệ thống không hợp lệ.');
export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tham số.');
export function actor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}
export function safeError(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new Error('SYS_DATABASE_FAILURE');
}
