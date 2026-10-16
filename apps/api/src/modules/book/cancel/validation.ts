import { z } from 'zod';
import {
  cancelPreviewRequestSchema,
  cancelRequestSchema,
  type CancelPreviewRequest,
  type CancelRequest,
} from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { FastifyRequest } from 'fastify';

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thao tác huỷ booking.');
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy booking.');
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu huỷ booking không hợp lệ.');
/** Xem trước đã cũ: tải lại và đối chiếu trước khi xác nhận (AC1, api.md §4.2). */
export const stale = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Xem trước đã cũ; hãy xem trước lại.');
export const precondition = () =>
  new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match để xác nhận huỷ.');
export const notAllowed = (message = 'Không thể huỷ booking ở trạng thái hiện tại.') =>
  new AppError(409, 'E_CANCEL_NOT_ALLOWED', message);
export const forceMajeureForbidden = () =>
  new AppError(
    403,
    'E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN',
    'Chỉ MANAGER/OWNER được huỷ bất khả kháng.',
  );
export const exceedsPaid = () =>
  new AppError(422, 'E_PAY_REFUND_EXCEEDS_PAID', 'Tiền hoàn vượt số đã thu.');

const uuidSchema = z.uuid().transform((s) => s.toLowerCase());

export function bookingId(value: unknown): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

export function previewInput(value: unknown): CancelPreviewRequest {
  const result = cancelPreviewRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  checkReasonPair(result.data.reason, result.data.isForceMajeure);
  return result.data;
}

export function cancelInput(value: unknown): CancelRequest {
  const result = cancelRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  checkReasonPair(result.data.reason, result.data.isForceMajeure);
  return result.data;
}

function checkReasonPair(reason: string, isForceMajeure: boolean): void {
  if (isForceMajeure !== (reason === 'FORCE_MAJEURE')) throw invalid();
}

export interface PreviewAnchor {
  readonly version: bigint;
  readonly decision: string | null;
}

/**
 * Neo xem trước (AC1): `"<version>"` kiểm mốc phiên bản; `"<version>.<quyết định>"`
 * (ETag của cancel-preview) kiểm thêm bậc/số hoàn đã xem — lệch mốc giờ/version → 412.
 * Thiếu header vẫn cho qua để tương thích client SCR-36 (không gửi If-Match).
 */
export function previewAnchor(value: unknown): PreviewAnchor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^"[1-9]\d{0,15}(?:\.[A-Za-z0-9_-]{1,64})?"$/.test(value))
    throw precondition();
  const [versionText, decision] = value.slice(1, -1).split('.');
  const version = BigInt(versionText!);
  if (version > BigInt(Number.MAX_SAFE_INTEGER)) throw precondition();
  return { version, decision: decision ?? null };
}

export function requestActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}
