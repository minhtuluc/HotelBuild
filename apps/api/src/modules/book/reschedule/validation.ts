/**
 * Chuẩn hoá đầu vào hai lệnh HB-098 (api.md §2.5, §3.3, §6.4; hợp đồng F5 trong `packages/contracts`):
 *
 * - `POST /bookings/{bookingId}/reschedule` — `checkIn`/`checkOut` của kỳ mới, `reason?`, `quoteId?`, kèm
 *   neo `If-Match` **bắt buộc** là `version` của booking (§6.4: "lệnh đổi ngày phải gửi quote mới đã
 *   chấp nhận và version"). Thiếu header ⇒ `428 E_GEN_PRECONDITION_REQUIRED`; sai/cũ ⇒ `412`.
 * - `DELETE /bookings/{bookingId}?reason=` — lý do là trường bắt buộc của hợp đồng
 *   (`bookingDeleteQuerySchema`) và cũng là điều kiện của trigger `trg_bookings_delete` (BR-BOOK-17):
 *   thiếu lý do thì CSDL chặn, nên chặn ở biên trước với cùng mã `400`.
 *
 * Mã lỗi theo đúng catalogue api.md §4.2 — không tự chế mã mới.
 */
import { bookingDeleteQuerySchema, rescheduleRequestSchema } from '@pinehill/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AppError } from '../../../common/app-error.js';
import { civilDay, isCivilDate, uuid } from '../../rate/calendar/support.js';

/** Sai kiểu/giá trị, mã tài nguyên không phải UUID, hoặc thiếu `reason` của lệnh xoá (§4.2 `E_GEN_*`). */
export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu đổi ngày/xoá đặt phòng không hợp lệ.');

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');

/** Không tồn tại — api.md §1.4: ID con phải tra từ aggregate đã kiểm quyền. */
export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy đặt phòng.');

/** BR-BOOK-12: trạng thái/hạn giữ chỗ, gói cấm đổi ngày, hết số lần, hoặc quá sát ngày nhận phòng. */
export const notAllowed = (message: string) => new AppError(409, 'E_BOOK_INVALID_STATE', message);

/** BR-BOOK-13: khách đã nhận phòng thì không sửa ngày được. */
export const checkedIn = () =>
  new AppError(
    409,
    'E_BOOK_CHECKED_IN_IMMUTABLE',
    'Khách đã nhận phòng; hãy trả phòng rồi tạo đặt phòng mới.',
  );

/** BR-BOOK-14/17: chỉ `DRAFT`/`HELD` **chưa** phát sinh thanh toán mới được xoá cứng. */
export const hardDeleteForbidden = (message: string) =>
  new AppError(409, 'E_BOOK_HARD_DELETE_FORBIDDEN', message);

/** `If-Match` lệch phiên bản đang khoá ⇒ `412 E_GEN_VERSION_CONFLICT` (api.md §1.3, §4.2). */
export const stale = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Đặt phòng đã thay đổi; hãy tải lại và thử lại.');

/** Lệnh đổi ngày là lệnh ghi có phiên bản ⇒ thiếu `If-Match` trả `428` (api.md §4.2). */
export const precondition = () =>
  new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match (version) để đổi ngày.');

/** BR-BOOK-02/BR-GEN-02: kỳ mới là khoảng nửa mở, không ở quá khứ, không xa hơn 365 ngày. */
export const invalidDates = () =>
  new AppError(422, 'E_BOOK_INVALID_DATES', 'Ngày nhận/trả phòng mới không hợp lệ.');

export interface RescheduleInput {
  readonly checkIn: string;
  readonly checkOut: string;
  /** Lý do thay đổi (tuỳ chọn theo hợp đồng) — vào `AuditLog` của lệnh. */
  readonly reason: string | null;
  /** Báo giá mới đã chấp nhận cho kỳ mới; thiếu thì máy chủ phát hành báo giá mới (§6.4). */
  readonly quoteId: string | null;
}

/** Thân `POST /bookings/{bookingId}/reschedule` — schema **strict**: trường lạ là lệnh hỏng. */
export function rescheduleInput(value: unknown): RescheduleInput {
  const parsed = rescheduleRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const { checkIn, checkOut, reason, quoteId } = parsed.data;
  // `businessDateSchema` chỉ kiểm khuôn `YYYY-MM-DD`; ngày lịch thật và chiều của kỳ do đây quyết.
  if (!isCivilDate(checkIn) || !isCivilDate(checkOut)) throw invalidDates();
  if (civilDay(checkOut) <= civilDay(checkIn)) throw invalidDates();
  return Object.freeze({
    checkIn,
    checkOut,
    reason: reason ?? null,
    quoteId: quoteId ?? null,
  });
}

/** `:bookingId` là UUID; sai định dạng ⇒ `400 E_GEN_VALIDATION_FAILED`. */
export function bookingId(value: unknown): string {
  return uuid(value);
}

/** `?reason=` của lệnh xoá cứng: bắt buộc **và không được rỗng trắng** (hợp đồng + trigger BR-BOOK-17). */
export function deleteReason(query: unknown): string {
  const parsed = bookingDeleteQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw invalid();
  const reason = parsed.data.reason.trim();
  if (reason.length === 0) throw invalid();
  return reason;
}

/**
 * Neo `If-Match`: `version` của booking. Nhận `"12"` (ETag chuẩn) và `12` (một số client bỏ dấu nháy)
 * vì hợp đồng F5 không quy định khuôn chuỗi; mọi giá trị không phải số nguyên dương ⇒ `412`.
 */
export function versionAnchor(value: unknown): bigint {
  if (value === undefined) throw precondition();
  if (typeof value !== 'string') throw stale();
  const match = /^(?:W\/)?"?([1-9][0-9]{0,15})"?$/.exec(value.trim());
  if (match === null) throw stale();
  return BigInt(match[1]!);
}

/**
 * Actor của guard (HB-013/014). Hai tuyến của HB-098 đều là tuyến **nhân viên** (`@Permission` +
 * `RbacGuard`) nên `request.actor` đã được dựng; thiếu ⇒ `403`.
 */
export function requestActor(request: FastifyRequest): AuthorizedActor {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}

/** `params` của hai tuyến — cùng cách đọc tham số đường dẫn như `BookingAccess` (HB-077). */
export const bookingParams = z.object({ bookingId: z.unknown() });

export function bookingParam(value: unknown): string {
  const params = bookingParams.safeParse(value);
  if (!params.success) throw invalid();
  return bookingId(params.data.bookingId);
}
