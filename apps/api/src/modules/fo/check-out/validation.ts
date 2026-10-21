/**
 * Biên nhận dữ liệu của lệnh trả phòng (api.md §2.9; HB-140 `checkOutRequestSchema`).
 * Mã lỗi dùng lại danh mục §4.2 — không thêm mã mới, không đổi hợp đồng.
 */
import type { FastifyRequest } from 'fastify';
import { checkOutRequestSchema, type CheckOutRequest } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được trả phòng booking này.');

export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Booking ngoài phạm vi cơ sở.');

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy booking.');

export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu trả phòng không hợp lệ.');

/** Chỉ booking `CHECKED_IN` mới trả phòng được (BR-FO-05). */
export const invalidState = () =>
  new AppError(409, 'E_BOOK_INVALID_STATE', 'Booking không ở trạng thái đã nhận phòng.');

/**
 * BR-FO-05: `balanceDue` phải về 0 trước khi in hoá đơn/giải phóng phòng — kể cả phụ thu vừa
 * ghi trong chính lệnh này. `422` + `E_PAY_AMOUNT_MISMATCH` là mã §4.2 gần nhất cho "còn phải thu".
 */
export const balanceUnsettled = () =>
  new AppError(422, 'E_PAY_AMOUNT_MISMATCH', 'Còn số dư phải thu trước khi trả phòng.');

/** Cờ `earlyCheckOut` phải khớp ngày trả phòng thực tế (BR-CANCEL-09). */
export const earlyMismatch = () =>
  new AppError(409, 'E_BOOK_INVALID_STATE', 'Cờ trả phòng sớm không khớp ngày trả phòng thực tế.');

/** Dữ liệu nội bộ không dựng được quyết định phụ thu: dừng an toàn, không đoán tiền. */
export const internal = () =>
  new AppError(500, 'E_GEN_SERVICE_UNAVAILABLE', 'Không thể tính phụ thu trả phòng.');

/** Hết hạn/đã dùng/sai đối tượng của `pinToken` là lỗi `401 E_AUTH_PIN_REQUIRED` (HB-015). */
export function checkOutInput(value: unknown): CheckOutRequest {
  const result = checkOutRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

export function requestActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw forbidden();
  return request.actor;
}
