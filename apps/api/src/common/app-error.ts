import type { ErrorCode } from '@pinehill/contracts';

/** Lỗi nghiệp vụ đã biết; filter đổi thành body lỗi theo `errorBodySchema` với đúng mã/trạng thái. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
