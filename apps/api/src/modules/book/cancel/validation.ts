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
  /** Vân tay của **toàn bộ** kết quả xem trước (bậc, tiền, phí, tập phòng) — xem `anchor.ts`. */
  readonly fingerprint: string;
}

/**
 * Neo xem trước **bắt buộc** (AC1; api.md §1.3: `If-Match` cho mọi thay đổi booking):
 * thiếu header → `428`, token sai/cũ → `412` (tải lại và xem trước lại).
 */
export function previewAnchor(value: unknown): PreviewAnchor {
  if (value === undefined) throw precondition();
  if (typeof value !== 'string' || !/^"[1-9]\d{0,15}\.[0-9a-f]{16}"$/.test(value)) throw stale();
  const [versionText, fingerprint] = value.slice(1, -1).split('.');
  const version = BigInt(versionText!);
  if (version > BigInt(Number.MAX_SAFE_INTEGER)) throw stale();
  return { version, fingerprint: fingerprint! };
}

const previewQuerySchema = z.object({
  bookingRoomIds: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Tập phòng của lần xem trước, cùng kênh dữ liệu với lệnh huỷ (api.md §3.3) — thân lệnh preview của
 * hợp đồng đã chốt chỉ có `reason`/`isForceMajeure` nên tập phòng đi bằng query, không đổi thân.
 * Bỏ trống ⇒ toàn bộ phòng đang hoạt động, đúng như lệnh huỷ không truyền `bookingRoomIds`.
 */
export function previewRooms(query: unknown): string[] | null {
  const parsed = previewQuerySchema.safeParse(query);
  if (!parsed.success) throw invalid();
  const raw = parsed.data.bookingRoomIds;
  if (raw === undefined) return null;
  const items = (Array.isArray(raw) ? raw : [raw]).flatMap((item) => item.split(','));
  const ids = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (!ids.length) throw invalid();
  return [...new Set(ids.map((id) => bookingId(id)))];
}

export function requestActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}
