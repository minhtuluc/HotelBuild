/**
 * Chiếu `payments` → hợp đồng PAY (api.md §3.5) và **nghĩa vụ phải thu** của một lần khởi tạo.
 *
 * Nguồn số là sổ cái (`BookingLedger.read`, HB-093) + snapshot bất biến của booking, không cột
 * `bookings.balance_due` đã biết lệch (TD-18) và **không** tính lại giá/chính sách ở đây:
 * - `DEPOSIT`: `depositAmount − paidByType['DEPOSIT']` (api.md §3.5 "amount PHẢI khớp depositAmount";
 *   BR-PAY-02/ADR-016 cấm dùng **tổng thu mọi loại** để bù trừ toàn cục — chỉ loại SUCCEEDED đúng loại),
 *   chỉ khi booking còn ở giai đoạn trước xác nhận **và** hold còn hạn — hết hạn thì nghĩa vụ bằng 0
 *   (AC2: bắt đầu thanh toán không gia hạn hold; tiền thu muộn đi vào đường hoàn BR-BOOK-18, HB-095).
 * - `BALANCE`: `balanceDue` của sổ cái (đã gồm phạt/phí/dịch vụ chưa trả, BR-PAY-02).
 * Nghĩa vụ `0n` ⇒ **mọi** số tiền đều là `422 E_PAY_AMOUNT_MISMATCH`: không có gì để thu thì không có
 * lệnh khởi tạo hợp lệ. Cùng công thức này là nguồn cho `onlineDepositAmount` của `GET /bookings/{id}/balance`
 * (HB-096) — một chỗ định nghĩa, không chép luật ra UI.
 */
import type { Prisma } from '@prisma/client';
import { paymentSchema, paymentStatusViewSchema } from '@pinehill/contracts';
import type { Payment, PaymentStatusView } from '@pinehill/contracts';

/** BR-PAY-05: một lần thanh toán quá 15 phút không có callback ⇒ FAILED cục bộ; cũng là `vnp_ExpireDate`. */
export const PAYMENT_WINDOW_SECONDS = 900;

/** Tiền tố `orderRef` **do máy chủ** sinh (F7): cổng thấy `PH-<payments.id>`; HB-095 bỏ tiền tố để tra. */
export const ORDER_REF_PREFIX = 'PH-';

/** Trạng thái đã kết thúc: không khởi tạo thanh toán mới (BR-PAY-11 giữ trạng thái kết thúc, không hồi sinh). */
export const ENDED_BOOKING_STATUSES: Readonly<Record<string, true>> = {
  CANCELLED: true,
  NO_SHOW: true,
  EXPIRED: true,
  CHECKED_OUT: true,
};

/**
 * Nghĩa vụ thanh toán được định nghĩa **một chỗ** ở `pay/ledger/obligation.ts` (hàm thuần dùng chung
 * với lệnh thu tại quầy HB-096 và `GET /bookings/{id}/balance`). Đường trực tuyến gọi thẳng
 * `obligationDue` với `roomOutstanding` từ projection sổ cái.
 */

/** Cột dùng cho chiếu `Payment`; không chọn và không trả bất kỳ dữ liệu thẻ/PII nào (BR-PAY-04). */
export const paymentSelect = {
  id: true,
  booking_id: true,
  type: true,
  method: true,
  amount: true,
  status: true,
  provider_txn_id: true,
  paid_at: true,
  created_at: true,
  created_by: true,
} satisfies Prisma.paymentsSelect;

export type PaymentRow = Prisma.paymentsGetPayload<{ select: typeof paymentSelect }>;

/** `GET /payments/{paymentId}/status` cần thêm chủ sở hữu booking để kiểm quyền (api.md §1.4). */
export const statusSelect = {
  ...paymentSelect,
  bookings: { select: { guest_id: true, property_id: true } },
} satisfies Prisma.paymentsSelect;

export type StatusRow = Prisma.paymentsGetPayload<{ select: typeof statusSelect }>;

export function projectPayment(row: PaymentRow, paymentUrl: string): Payment {
  return paymentSchema.parse({
    paymentId: row.id,
    bookingId: row.booking_id,
    type: row.type,
    method: row.method,
    amount: Number(row.amount),
    status: row.status,
    // BR-PAY-04: chỉ mã giao dịch cổng; `null` ở lúc khởi tạo vì PSP chưa trả kết quả.
    providerTxnId: row.provider_txn_id,
    paymentUrl,
    // Cửa sổ PSP tính từ chính hàng đã ghi ⇒ replay trả đúng cùng một hạn (BR-PAY-05).
    expiresAt: new Date(row.created_at.getTime() + PAYMENT_WINDOW_SECONDS * 1000).toISOString(),
    paidAt: row.paid_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  });
}

export function projectStatus(row: StatusRow): PaymentStatusView {
  return paymentStatusViewSchema.parse({
    paymentId: row.id,
    bookingId: row.booking_id,
    status: row.status,
    amount: Number(row.amount),
    providerTxnId: row.provider_txn_id,
    paidAt: row.paid_at?.toISOString() ?? null,
  });
}
