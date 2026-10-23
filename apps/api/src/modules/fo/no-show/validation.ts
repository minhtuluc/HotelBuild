/**
 * Chuẩn hoá đầu vào + mã lỗi của `POST /front-office/no-show` (HB-147; UC-FO-04; api.md §2.9).
 *
 * Hình dạng dây (`noShowRequestSchema`/`noShowResponseSchema`) đã có trong `@pinehill/contracts` —
 * hợp đồng không đổi ở ticket này. Lệnh chỉ chọn lý do tự do (BR-CANCEL-10) và `bookingId` do máy chủ
 * kiểm là UUID trước khi chạm CSDL (tránh `::uuid` ném lỗi 500 vì đầu vào sai).
 */
import { z } from 'zod';
import { noShowPreviewRequestSchema, noShowRequestSchema } from '@pinehill/contracts';
import type { NoShowPreviewRequest, NoShowRequest } from '@pinehill/contracts';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';

/** BR-CANCEL-10: mốc "hết ngày nhận phòng" theo giờ địa phương của cơ sở. */
export const NO_SHOW_MARK_TIME = '23:59:00';
/** Mã lý do ghi vào `room_assignments.release_reason` / `booking_status_history` của worker. */
export const NO_SHOW_REASON = 'NO_SHOW';

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được ghi nhận khách không đến.');
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy booking.');
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu ghi nhận khách không đến không hợp lệ.');

/**
 * BR-CANCEL-10 + BR-FO-02: chỉ booking `CONFIRMED` **và** đã tới 23:59 ngày nhận phòng mới ghi được
 * no-show. Cả hai điều kiện dùng cùng một mã 409 vì phía gọi không được phân biệt "sai trạng thái" với
 * "quá sớm" để tự đoán bước tiếp theo.
 */
export const invalidState = (
  message = 'Chỉ ghi nhận khách không đến cho booking CONFIRMED từ 23:59 ngày nhận phòng.',
) => new AppError(409, 'E_BOOK_INVALID_STATE', message);

const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

/** Thân lệnh đã chuẩn hoá: `bookingId` hạ chữ thường, `reason` giữ nguyên văn người nhập. */
export function noShowInput(value: unknown): NoShowRequest {
  const parsed = noShowRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const booking = uuidSchema.safeParse(parsed.data.bookingId);
  if (!booking.success) throw invalid();
  return Object.freeze({ bookingId: booking.data, reason: parsed.data.reason });
}

/** Thân lệnh xem trước (HB-209): chỉ `bookingId`, cùng chuẩn hoá UUID với lệnh ghi. */
export function noShowPreviewInput(value: unknown): NoShowPreviewRequest {
  const parsed = noShowPreviewRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const booking = uuidSchema.safeParse(parsed.data.bookingId);
  if (!booking.success) throw invalid();
  return Object.freeze({ bookingId: booking.data });
}

/** Tuyến không `@Public` nên `AuthGuard`/`RbacGuard` đã dựng `AuthorizedActor` từ CSDL. */
export function noShowActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}
