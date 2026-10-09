import type { ErrorBody, ErrorCode } from '@pinehill/contracts';

/** Lỗi nghiệp vụ đã biết; filter đổi thành body lỗi theo `errorBodySchema` với đúng mã/trạng thái. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** Số giây client nên chờ (429/401 khoá tài khoản) — filter gửi kèm body + header `Retry-After`. */
    readonly retryAfterSeconds?: number,
    /** Safe field/issue codes only; do not include submitted values or personal data. */
    readonly details?: ErrorBody['details'],
  ) {
    super(message);
    this.name = 'AppError';
  }
}
