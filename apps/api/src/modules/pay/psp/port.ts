/**
 * Hợp đồng cổng thanh toán (HB-094; api.md §3.5, §5.2; BR-PAY-01…05).
 *
 * Một hợp đồng duy nhất cho mọi cổng — `VnpayAdapter`/`MomoAdapter` chỉ khác định dạng tham số, thuật
 * toán ký và cách đối chiếu, đúng mô hình miền (03 §4.1: "hai cổng cùng hợp đồng tạo giao dịch và xác
 * minh callback; miền chỉ cần mã giao dịch, số tiền, trạng thái"). Nhờ vậy chuyển từ bộ **mô phỏng**
 * sang cổng thật chỉ là đổi cấu hình, không đổi lời gọi, không đổi mã nghiệp vụ.
 *
 * Vì sao có cả `init` lẫn `verify`:
 * - `init` dựng **URL chuyển hướng** có chữ ký (VNPay v2 và MoMo v2 đều là luồng chuyển hướng của
 *   khách). Đây là phép tính cục bộ, **không** gọi mạng ⇒ chạy được trong transaction nghiệp vụ mà
 *   không vi phạm `common/idempotency/README.md` mục 3 ("công việc ngoài DB đi qua outbox").
 * - `verify` xác minh **sự kiện PSP gửi về** (IPN) rồi trả hình dạng miền; người gọi (HB-095) so
 *   `orderRef`/`amount` với `Payment` đã lưu trước khi ghi tiền (BR-PAY-03).
 *
 * KHÔNG có trường thẻ/CVV/ngày hết hạn ở bất kỳ cấu trúc nào (BR-PAY-04, NFR-SEC-02, api.md §2.14).
 * KHÔNG log tham số nhạy cảm: adapter trả dữ liệu, không ghi log.
 */

/** Hai cổng dùng được cho `POST /payments/online` (api.md §2.6, §3.5). */
export type PspMethod = 'VNPAY' | 'MOMO';

/** `mock` = chưa có bộ khoá sandbox; `live` = đã cấu hình đủ bộ khoá của cổng đó. */
export type PspMode = 'mock' | 'live';

/** Kết quả đã chuẩn hoá của một sự kiện PSP (IPN) — hình dạng miền của §5.2. */
export interface PspResult {
  /** `vnp_TxnRef`/`orderId`: mã đơn phía cổng, chính là `orderRef` ta phát hành lúc `init`. */
  readonly orderRef: string;
  /** `vnp_TransactionNo`/`transId`: mã giao dịch cổng, lưu vào `payments.provider_txn_id` (BR-PAY-04). */
  readonly providerTxnId: string | null;
  /** VND số nguyên; VNPay chuyển đơn vị ×100 đúng **một lần** ở biên (BR-PAY-01, §5.2). */
  readonly amount: bigint;
  readonly outcome: 'SUCCEEDED' | 'FAILED';
  /** Thời điểm cổng ghi nhận (`vnp_PayDate`/IPN trả về), `null` khi không xác định được. */
  readonly paidAt: Date | null;
}

/** Lệnh khởi tạo giao dịch: số tiền lấy từ nghĩa vụ máy chủ, không phải từ yêu cầu của khách. */
export interface PspInitRequest {
  /** `orderRef` bền, gắn booking + khoản (AC1): lưu ở `payments.idempotency_key` để BR-PAY-03 đối chiếu. */
  readonly orderRef: string;
  readonly amount: bigint;
  readonly type: 'DEPOSIT' | 'BALANCE';
  /** Trang hiển thị kết quả phía khách; **chỉ** để cổng chuyển hướng (không phải bằng chứng đã trả). */
  readonly returnUrl: string;
  /** URL công khai PSP gọi về (`ipnUrl` của MoMo), dựng từ `PAYMENT_PSP_CALLBACK_BASE_URL`. */
  readonly ipnUrl: string;
  /** Giờ CSDL/đồng hồ tiêm (`Clock`) — adapter **không** tự gọi `new Date()` (QT §2). */
  readonly now: Date;
  /** IP người gọi cho `vnp_IpAddr`; không đưa vào log/nhật ký. */
  readonly ip: string | null;
}

/** Phiên giao dịch do cổng cấp cho khách. */
export interface PspInit {
  readonly paymentUrl: string;
  /** Mã phiên ngắn hạn phía cổng (`vnp_SecureHash`+`vnp_TxnRef` / MoMo `signature`); đối chiếu khi cần. */
  readonly token: string;
  /** Mã đơn phía cổng; trả lại nguyên `orderRef` đã phát hành. */
  readonly providerRef: string;
}

export interface PaymentGatewayAdapter {
  readonly method: PspMethod;
  readonly mode: PspMode;
  init(request: PspInitRequest): PspInit;
  /** `null` = chữ ký/merchant/định dạng không hợp lệ ⇒ người gọi KHÔNG được ghi tiền (§5.2). */
  verify(raw: string): PspResult | null;
}
