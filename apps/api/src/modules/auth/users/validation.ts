import type { FastifyRequest } from 'fastify';
import {
  createUserRequestSchema,
  userAccessUpdateRequestSchema,
  usersQuerySchema,
} from '@pinehill/contracts';
import type { CreateUserRequest, UserAccessUpdateRequest, UsersQuery } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { forbidden, validationFailed } from './rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export const notFound = (): AppError =>
  new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

export function requestActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}

export function listQuery(raw: unknown): UsersQuery {
  const parsed = usersQuerySchema.safeParse(raw);
  if (!parsed.success) throw validationFailed();
  const { propertyId, cursor } = parsed.data;
  if (
    (propertyId !== undefined && !isUuid(propertyId)) ||
    (cursor !== undefined && !isUuid(cursor))
  )
    throw validationFailed();
  return parsed.data;
}

export function createInput(body: unknown): CreateUserRequest {
  const parsed = createUserRequestSchema.safeParse(body);
  if (!parsed.success) throw validationFailed();
  return parsed.data;
}

export function accessInput(body: unknown): UserAccessUpdateRequest {
  const parsed = userAccessUpdateRequestSchema.safeParse(body);
  if (!parsed.success) throw validationFailed();
  const scope = [...new Set(parsed.data.propertyScope)];
  if (scope.some((id) => !isUuid(id))) throw validationFailed();
  return { ...parsed.data, propertyScope: scope.sort() };
}

/** Id trong đường dẫn không phải UUID thì không thể tồn tại: 404 (không lộ khác biệt). */
export function pathUserId(value: unknown): string {
  if (typeof value !== 'string' || !isUuid(value)) throw notFound();
  return value.toLowerCase();
}

/**
 * `If-Match` của `PUT /users/{id}/access` (api.md §1.3): thiếu ⇒ 428; sai định dạng ⇒ 412.
 * `version` là micro-giây epoch của `users.updated_at` (không có cột version) nên là số nguyên 16 chữ số.
 */
export function expectedVersion(value: unknown): bigint {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match để cập nhật.');
  if (typeof value !== 'string' || !/^"(?:0|[1-9]\d{0,15})"$/.test(value))
    throw new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Dữ liệu đã thay đổi; hãy tải lại.');
  return BigInt(value.slice(1, -1));
}
