/**
 * Chuẩn hoá đầu vào + mã lỗi của hai tuyến PAY trực tuyến (HB-094; api.md §2.6, §3.5, §4.2).
 *
 * Hình dạng thân lệnh do `onlinePaymentCreateRequestSchema` (HB-090) chốt và là **strict**: gửi kèm
 * trường lạ — kể cả trường thẻ/CVV — bị từ chối `400 E_GEN_VALIDATION_FAILED`, đúng §2.14/BR-PAY-04
 * (hệ thống không có chỗ nào nhận dữ liệu thẻ). Ở đây siết thêm ba điều schema không biểu diễn được:
 * `method` chỉ VNPAY/MOMO, `type` chỉ DEPOSIT/BALANCE (các loại khác do đường nghiệp vụ riêng sinh),
 * và `bookingId` phải là UUID để không bao giờ chạm câu truy vấn `uuid` của CSDL.
 */
import { onlinePaymentCreateRequestSchema } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { uuid } from '../../rate/calendar/support.js';
import type { PspMethod } from '../psp/port.js';

/** Khoản khách tự trả trực tuyến: cọc và số dư. Phạt/phí/hoàn có đường riêng (BR-PAY-06…09). */
export type OnlineType = 'DEPOSIT' | 'BALANCE';

export const invalid = () =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu thanh toán trực tuyến không hợp lệ.');

/** BR-PAY-01/02: số tiền phải khớp **nghĩa vụ hiện tại** do máy chủ tính, không tin tham số khách gửi. */
export const amountMismatch = () =>
  new AppError(422, 'E_PAY_AMOUNT_MISMATCH', 'Số tiền không khớp số phải thu.');

export const invalidState = (message: string) => new AppError(409, 'E_BOOK_INVALID_STATE', message);

export const missing = () => new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy tài nguyên.');

export const forbidden = () =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');

export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');

/** §4.3: lỗi từ adapter ngoài ⇒ `502 E_PAY_GATEWAY_ERROR`, không lộ chi tiết cổng ra ngoài. */
export const gatewayError = () =>
  new AppError(502, 'E_PAY_GATEWAY_ERROR', 'Cổng thanh toán không sẵn sàng.');

function isOnlineType(value: string): value is OnlineType {
  return value === 'DEPOSIT' || value === 'BALANCE';
}

function isOnlineMethod(value: string): value is PspMethod {
  return value === 'VNPAY' || value === 'MOMO';
}

/** Đầu vào đã chuẩn hoá; số tiền giữ `bigint` để so với sổ cái mà không qua số thực. */
export interface OnlinePaymentInput {
  readonly bookingId: string;
  readonly type: OnlineType;
  readonly method: PspMethod;
  readonly amount: bigint;
  readonly returnUrl: string;
}

export function onlinePaymentInput(value: unknown): OnlinePaymentInput {
  const parsed = onlinePaymentCreateRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const request = parsed.data;
  if (!isOnlineType(request.type) || !isOnlineMethod(request.method)) throw invalid();
  return Object.freeze({
    bookingId: uuid(request.bookingId),
    type: request.type,
    method: request.method,
    amount: BigInt(request.amount),
    returnUrl: request.returnUrl,
  });
}

/** `Idempotency-Key` là khoá bền của lệnh (api.md §1.6); cũng chính là `orderRef` cổng (§5.2, BR-PAY-03). */
export function commandKey(header: string | string[] | undefined): string {
  if (typeof header !== 'string' || header.length === 0) throw invalid();
  return header.toLowerCase();
}
