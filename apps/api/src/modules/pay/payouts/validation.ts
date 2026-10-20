/** Cổng vào lệnh chi hoàn (HB-100; api.md §2.6, BR-CANCEL-16, BR-PAY-08/09). */
import { refundPayRequestSchema, type ErrorCode, type RefundPayRequest } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';

/**
 * Mã lỗi lấy đúng bộ đã chốt ở api.md §4.2 — không thêm mã mới ngoài hợp đồng. `E_PAY_GATEWAY_ERROR`
 * dùng cho lần chi trước đã thất bại dứt điểm (phải đối soát tay trước khi chi lại).
 */
const ERRORS = {
  missing: [404, 'E_GEN_NOT_FOUND', 'Không tìm thấy hồ sơ hoàn tiền.'],
  invalid: [400, 'E_GEN_VALIDATION_FAILED', 'Lệnh chi hoàn không hợp lệ.'],
  forbidden: [403, 'E_RBAC_FORBIDDEN', 'Bạn không được chi tiền hoàn.'],
  notApproved: [409, 'E_PAY_REFUND_NOT_APPROVED', 'Chỉ chi hồ sơ đã được duyệt.'],
  gateway: [502, 'E_PAY_GATEWAY_ERROR', 'Lần chi trước thất bại dứt điểm; cần đối soát thủ công.'],
} as const satisfies Record<string, readonly [number, ErrorCode, string]>;

export type PayoutErrorCode = keyof typeof ERRORS;

export function payoutError(code: PayoutErrorCode, message?: string): AppError {
  const [status, errorCode, fallback] = ERRORS[code];
  return new AppError(status, errorCode, message ?? fallback);
}

export function payInput(value: unknown): RefundPayRequest {
  const result = refundPayRequestSchema.safeParse(value);
  if (!result.success) throw payoutError('invalid');
  return result.data;
}

/** Phương thức chi suy từ **phương thức gốc** (BR-PAY-08): tiền mặt → chuyển khoản, OTA giữ tiền thì không tự chi. */
export function payoutMethodOf(originalMethod: string): 'VNPAY' | 'MOMO' | 'BANK_TRANSFER' | null {
  if (originalMethod === 'CASH' || originalMethod === 'BANK_TRANSFER') return 'BANK_TRANSFER';
  if (originalMethod === 'VNPAY' || originalMethod === 'MOMO') return originalMethod;
  return null;
}

/** Một lệnh chi chỉ nhận **một** phương thức; khoản chuyển khoản phải có ghi chú tài khoản (BR-PAY-08). */
export function checkMethod(
  input: RefundPayRequest,
  originals: readonly string[],
): 'VNPAY' | 'MOMO' | 'BANK_TRANSFER' {
  if (originals.length === 0) throw payoutError('invalid', 'Hồ sơ hoàn chưa có phân bổ nguồn thu.');
  const required = originals.map(payoutMethodOf);
  const only = required[0];
  if (only === undefined || only === null)
    throw payoutError(
      'invalid',
      'Khoản thu OTA do OTA giữ tiền phải đối soát qua OTA, không chi từ cổng nội bộ.',
    );
  if (required.some((method) => method !== only) || only !== input.method)
    throw payoutError('invalid', 'Phương thức chi phải khớp phương thức gốc của mọi nguồn hoàn.');
  if (only === 'BANK_TRANSFER' && (input.bankNote ?? '').trim().length === 0)
    throw payoutError('invalid', 'Chuyển khoản hoàn tiền cần ghi chú số tài khoản (BR-PAY-08).');
  return only;
}
