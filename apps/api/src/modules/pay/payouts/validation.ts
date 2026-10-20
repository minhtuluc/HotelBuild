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
export type PayoutMethod = 'VNPAY' | 'MOMO' | 'BANK_TRANSFER';

export function payoutMethodOf(originalMethod: string): PayoutMethod | null {
  if (originalMethod === 'CASH' || originalMethod === 'BANK_TRANSFER') return 'BANK_TRANSFER';
  if (originalMethod === 'VNPAY' || originalMethod === 'MOMO') return originalMethod;
  return null;
}

/**
 * Mỗi leg chi theo **phương thức gốc của receipt của nó** (ADR-016: "Một yêu cầu có thể chi qua nhiều
 * phương thức"), không ép cả hồ sơ về một phương thức. Chỉ khoản OTA giữ tiền là không tự chi.
 */
export function legMethods(originals: readonly string[]): PayoutMethod[] {
  if (originals.length === 0) throw payoutError('invalid', 'Hồ sơ hoàn chưa có phân bổ nguồn thu.');
  return originals.map((original) => {
    const method = payoutMethodOf(original);
    if (method === null)
      throw payoutError(
        'invalid',
        'Khoản thu OTA do OTA giữ tiền phải đối soát qua OTA, không chi từ cổng nội bộ.',
      );
    return method;
  });
}

/**
 * `method` trong thân lệnh là **ý định** của kế toán, không phải phương thức duy nhất của mọi leg:
 * - mọi leg cùng một phương thức ⇒ phải khai đúng phương thức đó;
 * - nhiều phương thức ⇒ phải khai một trong các phương thức thực tế (không tự tách lệnh chi).
 * Có leg chuyển khoản ⇒ bắt buộc `bankNote` (BR-PAY-08).
 */
export function checkIntent(input: RefundPayRequest, methods: readonly PayoutMethod[]): void {
  const first = methods[0];
  if (first === undefined) throw payoutError('invalid', 'Hồ sơ hoàn chưa có phân bổ nguồn thu.');
  const single = methods.every((method) => method === first);
  const declared = single
    ? input.method === first
    : methods.some((method) => method === input.method);
  if (!declared)
    throw payoutError('invalid', 'Phương thức chi phải khớp phương thức gốc của nguồn hoàn.');
  if (
    methods.some((method) => method === 'BANK_TRANSFER') &&
    (input.bankNote ?? '').trim().length === 0
  )
    throw payoutError('invalid', 'Chuyển khoản hoàn tiền cần ghi chú số tài khoản (BR-PAY-08).');
}
