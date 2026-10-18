/**
 * Lỗi của lệnh thanh toán tại quầy (HB-096) — mã đúng danh mục api.md §4.2, một chỗ cho cả
 * principal lẫn service.
 *
 * Sai tiền so nghĩa vụ hiện hành trả `422 E_PAY_AMOUNT_MISMATCH` (api.md §3.5, BR-PAY-01/02);
 * booking không ở trạng thái thu được hoặc không còn khoản phải thu trả `409 E_BOOK_INVALID_STATE`;
 * thiếu/xấu/hết hạn `pinToken` trả `401 E_AUTH_PIN_REQUIRED` từ `requirePinToken` (HB-015);
 * quyền/phạm vi trả 403 theo api.md §6.1.
 */
import { AppError } from '../../../common/app-error.js';

export const invalid = () => new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');

export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.') =>
  new AppError(403, 'E_RBAC_FORBIDDEN', message);

export const invalidState = (message: string) => new AppError(409, 'E_BOOK_INVALID_STATE', message);

/**
 * `amount` khác đúng nghĩa vụ máy chủ tính. `details.issue` chỉ chở **mã**, không chở số tiền/PII
 * (an toàn để trả ra ngoài theo api.md §4.1).
 */
export const amountMismatch = () =>
  new AppError(
    422,
    'E_PAY_AMOUNT_MISMATCH',
    'Số tiền không khớp nghĩa vụ máy chủ chốt.',
    undefined,
    [{ field: 'amount', issue: 'MUST_MATCH_SERVER_OBLIGATION' }],
  );
