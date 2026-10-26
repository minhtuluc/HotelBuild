/**
 * Nghĩa vụ hiện hành và kế hoạch phân bổ của lệnh thu tại quầy (HB-096; BR-PAY-01/02, api.md §3.5).
 *
 * `DEPOSIT`/`BALANCE` **không** định nghĩa lại công thức: gọi thẳng `obligationDue` của
 * `pay/ledger/obligation.ts` — một chỗ duy nhất dùng chung với `POST /payments/online` (HB-094) và
 * `onlineDepositAmount` của `GET /bookings/{id}/balance` (cọc bị chặn bởi nghĩa vụ ROOM còn lại).
 * Các loại phí `PENALTY`/`EXTRA_SERVICE`/`RESCHEDULE_FEE` là nghĩa vụ riêng của quầy nên vẫn tính theo
 * `kind` tương ứng; `REFUND`/`COMPENSATION` là đường **chi**, không thu tại quầy.
 *
 * Phân bổ tiền: thứ tự bất biến ROOM → PENALTY → EXTRA_SERVICE → RESCHEDULE_FEE (BR-PAY-02); nhóm ROOM
 * chia theo trọng số phòng bằng allocator chuẩn của `pay/ledger` (một công thức với engine huỷ, HB-211).
 */
import type { PaymentCreateRequest } from '@pinehill/contracts';
import { obligationDue } from '../ledger/obligation.js';
import { planReceiptAllocation } from '../ledger/receipt-allocation.js';
import type { AllocationLine, ReceiptCharge } from '../ledger/receipt-allocation.js';

/** Loại thu tại quầy được phép (không gồm đường chi REFUND/COMPENSATION). */
export const COUNTER_TYPES = [
  'DEPOSIT',
  'BALANCE',
  'PENALTY',
  'EXTRA_SERVICE',
  'RESCHEDULE_FEE',
] as const;

export type CounterType = (typeof COUNTER_TYPES)[number];

/** Bảng tra tĩnh chuỗi→cờ (QT: không dùng `Set` cho tập khoá tĩnh). */
const COUNTER_TYPE_BY_NAME: Readonly<Record<string, true>> = {
  DEPOSIT: true,
  BALANCE: true,
  PENALTY: true,
  EXTRA_SERVICE: true,
  RESCHEDULE_FEE: true,
};

export type ChargeLine = ReceiptCharge;

/** Dữ kiện đủ cho mọi loại thu: bối cảnh booking (cho hàm chung) + nghĩa vụ từng `kind`. */
export interface CounterObligationFacts {
  readonly status: string;
  /** `bookings.deposit_amount` — engine HB-074/077 chốt, không tính lại. */
  readonly depositAmount: bigint;
  /** Tổng `DEPOSIT` đã thu SUCCEEDED (đúng loại, `projection.paidByType['DEPOSIT']`). */
  readonly depositPaid: bigint;
  /** Tổng nghĩa vụ còn lại — `BookingLedger.balanceDue`. */
  readonly balanceDue: bigint;
  readonly holdExpiresAt: Date | null;
  /** Giờ CSDL đọc sau khoá (ADR-014). */
  readonly now: Date;
  /** Nghĩa vụ còn lại theo từng dòng `booking_charges` (đã trừ `voided_amount`/đã phân bổ). */
  readonly outstanding: readonly ChargeLine[];
}

/** Thứ tự phân bổ bất biến: tiền phòng trước, rồi phạt → dịch vụ → phí đổi (BR-PAY-02). */
const ALLOCATION_ORDER: Readonly<Record<string, readonly string[]>> = {
  DEPOSIT: ['ROOM', 'PENALTY', 'EXTRA_SERVICE', 'RESCHEDULE_FEE'],
  BALANCE: ['ROOM', 'PENALTY', 'EXTRA_SERVICE', 'RESCHEDULE_FEE'],
  PENALTY: ['PENALTY'],
  EXTRA_SERVICE: ['EXTRA_SERVICE'],
  RESCHEDULE_FEE: ['RESCHEDULE_FEE'],
};

export function isCounterType(type: string): type is CounterType {
  return COUNTER_TYPE_BY_NAME[type] === true;
}

function outstandingOfKinds(facts: CounterObligationFacts, kinds: readonly string[]): bigint {
  return facts.outstanding
    .filter((line) => kinds.includes(line.kind))
    .reduce((sum, line) => sum + line.outstanding, 0n);
}

/** Số tiền máy chủ cho phép thu cho `type`; `0n` nghĩa là không còn khoản phải thu. */
export function dueAmount(type: CounterType, facts: CounterObligationFacts): bigint {
  if (type === 'DEPOSIT' || type === 'BALANCE')
    return obligationDue(
      {
        status: facts.status,
        depositAmount: facts.depositAmount,
        depositPaid: facts.depositPaid,
        balanceDue: facts.balanceDue,
        roomOutstanding: outstandingOfKinds(facts, ['ROOM']),
        holdExpiresAt: facts.holdExpiresAt,
        now: facts.now,
      },
      type,
    );
  return outstandingOfKinds(facts, ALLOCATION_ORDER[type] ?? []);
}

/**
 * Chia một khoản thu cho các nghĩa vụ theo thứ tự ổn định `(kind ưu tiên, id)`; nhóm ROOM chia theo
 * trọng số phòng. Tổng không vượt số tiền thu và không vượt nghĩa vụ còn lại của từng dòng.
 */
export function allocationPlan(
  type: CounterType,
  amount: bigint,
  facts: CounterObligationFacts,
): readonly AllocationLine[] {
  return planReceiptAllocation(amount, facts.outstanding, ALLOCATION_ORDER[type] ?? []);
}

/** Kiểu hợp đồng nhỏ để hàm thuần dùng lại được ở test mà không cần request. */
export type CounterRequestType = PaymentCreateRequest['type'];
