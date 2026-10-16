/**
 * Helper dùng chung cho hai module của HB-054 (lịch giá + mùa): lỗi theo catalogue, UUID, quyền,
 * che PII và số học ngày dân sự. Không chứa luật giá — luật giá nằm ở engine `@pinehill/domain/pricing`.
 */
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy cấu hình giá.');
export const invalid = () => new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');
export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');

export interface Issue {
  readonly field: string;
  readonly issue: string;
}

/** 422 `E_RATE_CONFIGURATION_INVALID` — một trường/ngày hỏng (BR-RATE-03/04, BR-RBAC-04). */
export function configuration(
  field: string,
  issue: string,
  message = 'Cấu hình giá không hợp lệ.',
): never {
  throw new AppError(422, 'E_RATE_CONFIGURATION_INVALID', message, undefined, [{ field, issue }]);
}

/** 422 gộp nhiều dòng hỏng trong một lệnh; `details` chỉ chứa mã trường/mã lỗi, không chứa giá trị gửi lên. */
export function configurationAll(
  details: readonly Issue[],
  message = 'Cấu hình giá không hợp lệ.',
): never {
  throw new AppError(422, 'E_RATE_CONFIGURATION_INVALID', message, undefined, [...details]);
}

export function uuid(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data.toLowerCase();
}

export function requestActor(request: FastifyRequest): AuthorizedActor {
  if (!isAuthorizedActor(request.actor))
    throw new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực.');
  return request.actor;
}

/** Ghi cấu hình giá chỉ dành cho OWNER (BR-RBAC-02/04); quyền ở guard là lớp thứ nhất, đây là lớp thứ hai. */
export function owner(actor: AuthorizedActor): AuthorizedActor {
  if (actor.role !== 'OWNER') throw forbidden();
  return actor;
}

/** Đọc cấu hình giá cho MANAGER/OWNER (api.md §2.4, §6.1). */
export function reader(actor: AuthorizedActor): AuthorizedActor {
  if (actor.role !== 'OWNER' && actor.role !== 'MANAGER') throw forbidden();
  return actor;
}

const EMAIL = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/gu;
const PHONE = /\+?\d[\d\s().-]*\d/gu;

/** Che PII nhận dạng được trước khi ghi audit/DTO (NFR-SEC-03); raw request giữ nguyên cho hash idempotency. */
export function maskText(value: string): string {
  return value
    .replace(EMAIL, (match) => `****${match.slice(-4)}`)
    .replace(PHONE, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 9 ? `****${digits.slice(-4)}` : match;
    });
}

const DAY = 86400000;

/** `YYYY-MM-DD` → số ngày dân sự; ngày không tồn tại (vd. 2026-02-30) bị coi là yêu cầu hỏng. */
export function civilDay(value: string): number {
  if (!isCivilDate(value)) throw invalid();
  return Date.parse(`${value}T00:00:00.000Z`) / DAY;
}

export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function civilDate(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/** Ngày kế tiếp theo lịch dân sự — `checkOut` của engine là mốc **loại trừ** (HB-052 §1.5). */
export function nextDay(value: string): string {
  return civilDate(civilDay(value) + 1);
}

/** `date` của Prisma là kiểu `date`; luôn dựng từ ngày UTC nửa đêm để không lệch múi giờ máy chủ. */
export function sqlDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Cột ngày (`date`/`timestamptz` nửa đêm UTC) → `YYYY-MM-DD` dân sự; không dùng múi giờ máy chủ. */
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Lỗi CSDL/engine bất ngờ: không rò chi tiết Prisma ra ngoài, giữ AppError nghiệp vụ nguyên vẹn. */
export function safeDatabaseError(error: unknown): never {
  if (error instanceof AppError) throw error;
  throw new Error('RATE_CONFIGURATION_DATABASE_FAILURE');
}

/** Khoá duy nhất của Prisma (P2002) — dùng để trả lỗi nghiệp vụ thay vì 500. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
