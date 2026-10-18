/**
 * Nghĩa vụ thanh toán của một booking — **một chỗ định nghĩa** cho mọi đường thu tiền
 * (`POST /payments` tại quầy HB-096, `POST /payments/online` HB-094, `onlineDepositAmount` của
 * `GET /bookings/{id}/balance`). api.md §3.5, BR-PAY-01/02, ADR-016.
 *
 * Hàm thuần, không I/O: nhận số đã chốt của booking + số đã thu **đúng loại** + tổng nghĩa vụ còn lại.
 *
 * - `DEPOSIT`: chỉ có nghĩa vụ khi booking còn ở giai đoạn **trước xác nhận** và hold còn hạn (hết hạn
 *   thì 0 — bắt đầu thanh toán không gia hạn hold; tiền thu muộn theo BR-BOOK-18/BR-PAY-11).
 *   Số phải thu = `max(0, depositAmount − Σ DEPOSIT đã thu)`, **chặn bởi nghĩa vụ ROOM còn lại**
 *   (`Σ ROOM` chưa phân bổ): cọc là tiền phòng nên không được thu vượt nghĩa vụ phòng — BR-PAY-02 cấm
 *   bù trừ toàn cục bằng tổng thu mọi loại, và không tạo tiền dư ngoài nghĩa vụ.
 * - `BALANCE`: tổng nghĩa vụ còn lại của sổ cái (`BookingLedger.balanceDue`, đã gồm phạt/phí/dịch vụ).
 */
export type ObligationType = 'DEPOSIT' | 'BALANCE';

/** Giai đoạn **trước xác nhận**: cọc còn là nghĩa vụ của khách (BR-BOOK-09). */
export const PRE_CONFIRMATION_STATUSES: Readonly<Record<string, true>> = {
  DRAFT: true,
  HELD: true,
  PENDING_PAYMENT: true,
};

export interface ObligationFacts {
  readonly status: string;
  /** Snapshot bất biến từ booking (HB-077), không suy lại từ `totalAmount × percent`. */
  readonly depositAmount: bigint;
  /** Tổng thu SUCCEEDED **đúng loại** `DEPOSIT` (`LedgerProjection.paidByType['DEPOSIT']`). */
  readonly depositPaid: bigint;
  /** Tổng nghĩa vụ còn phải thu (`LedgerProjection.balanceDue`). */
  readonly balanceDue: bigint;
  /** Tổng nghĩa vụ `ROOM` còn lại (`LedgerProjection.outstandingByKind['ROOM']`). */
  readonly roomOutstanding: bigint;
  readonly holdExpiresAt: Date | null;
  /** Giờ CSDL đọc sau khi khoá (ADR-014). */
  readonly now: Date;
}

function smaller(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export function obligationDue(facts: ObligationFacts, type: ObligationType): bigint {
  if (type === 'BALANCE') return facts.balanceDue;
  if (PRE_CONFIRMATION_STATUSES[facts.status] !== true) return 0n;
  if (facts.holdExpiresAt !== null && facts.holdExpiresAt.getTime() <= facts.now.getTime())
    return 0n;
  const shortfall = facts.depositAmount - facts.depositPaid;
  const remaining = shortfall > 0n ? shortfall : 0n;
  return smaller(remaining, facts.roomOutstanding);
}
