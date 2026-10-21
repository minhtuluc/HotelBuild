/**
 * Lỗi của `POST /front-office/check-in` (HB-144, api.md §4.2). Chỉ dùng mã đã công bố:
 * `E_FO_CHECKIN_NOT_ALLOWED` (409) cho mọi cổng nghiệp vụ BR-FO-01/02/04/07, `E_GEN_NOT_FOUND` (404)
 * cho đặt phòng/phòng không tồn tại, `E_GEN_VALIDATION_FAILED` (400) cho thân lệnh hỏng.
 * Thông điệp không chứa PII (NFR-SEC-03) và không suy ra được dữ liệu của booking khác.
 */
import { AppError } from '../../../common/app-error.js';
import type { CheckInFailure } from '@pinehill/domain/front-office';

const reasonMessage: Readonly<Record<string, string>> = {
  STATUS: 'Chỉ nhận phòng cho đặt phòng đã xác nhận.',
  NO_SHOW_REQUIRED: 'Đã tới mốc 23:59 ngày nhận phòng; hãy xử lý no-show trước.',
  WRONG_DATE: 'Hôm nay không phải ngày nhận phòng của đặt phòng này.',
  UNITS_NOT_READY: 'Phòng thực tế chưa sẵn sàng để giao cho khách.',
  ADDITIONAL_NIGHT_REQUIRED: 'Nhận phòng trước 08:00 cần đặt thêm một đêm.',
  DEBT_APPROVAL_REQUIRED: 'Còn nợ vượt ngưỡng; cần quản lý hoặc chủ sở hữu duyệt cho nợ.',
};

export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu nhận phòng không hợp lệ.');

export const missing = () =>
  new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy đặt phòng hoặc phòng.');

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được nhận phòng cho đặt phòng này.');

/** Cổng nghiệp vụ từ chối (BR-FO-01/02/04/07) — luôn 409 `E_FO_CHECKIN_NOT_ALLOWED`. */
export function refused(failure: CheckInFailure): AppError {
  if (failure.code === 'E_FO_INVALID_INPUT')
    return new AppError(
      409,
      'E_FO_CHECKIN_NOT_ALLOWED',
      'Dữ kiện đặt phòng không đủ để quyết định nhận phòng.',
    );
  return new AppError(409, 'E_FO_CHECKIN_NOT_ALLOWED', reasonMessage[failure.reason]!);
}

/** Từ chối vì trạng thái dữ liệu tải sau khoá (phòng khác loại, đã bị chiếm…). */
export const conflict = (message: string) => new AppError(409, 'E_FO_CHECKIN_NOT_ALLOWED', message);
