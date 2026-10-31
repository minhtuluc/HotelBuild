/**
 * Lỗi của lệnh chốt đối soát ngày (`POST /reconciliation/daily/close`, HB-150; api.md §2.6, §4.2).
 */
import { AppError } from '../../../common/app-error.js';

export const invalid = () => new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');

export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.') =>
  new AppError(403, 'E_RBAC_FORBIDDEN', message);

export const alreadyClosed = () =>
  new AppError(
    409,
    'E_BOOK_INVALID_STATE',
    'Đối soát ngày của người thu này đã được chốt trước đó.',
  );
