import type {
  bookings,
  payments,
  booking_charges,
  payment_allocations,
  refund_requests,
  refund_allocations,
} from '@prisma/client';
export interface LedgerFacts {
  booking: Pick<
    bookings,
    'id' | 'property_id' | 'status' | 'paid_amount' | 'refunded_amount' | 'balance_due'
  >;
  payments: Pick<payments, 'id' | 'booking_id' | 'type' | 'amount' | 'status'>[];
  charges: Pick<booking_charges, 'id' | 'booking_id' | 'kind' | 'amount' | 'voided_amount'>[];
  allocations: Pick<
    payment_allocations,
    'id' | 'payment_id' | 'charge_id' | 'amount' | 'released_amount'
  >[];
  refunds: Pick<refund_requests, 'id' | 'booking_id' | 'status' | 'net_refund'>[];
  refundAllocations: Pick<
    refund_allocations,
    'id' | 'refund_request_id' | 'original_payment_id' | 'refund_payment_id' | 'amount'
  >[];
}
export interface LedgerSource {
  paymentId: string;
  collected: bigint;
  applied: bigint;
  refunded: bigint;
  reserved: bigint;
  available: bigint;
}
export interface LedgerProjection {
  paidAmount: bigint;
  refundedAmount: bigint;
  refundReserved: bigint;
  balanceDue: bigint;
  /** Tổng thu SUCCEEDED **theo từng loại** Payment (VND nguyên) — đúng BR-PAY-02/ADR-016: người tiêu
   * thụ lấy đúng nghĩa vụ mình cần (vd. cọc), **không** dùng tổng thu mọi loại để bù trừ toàn cục. */
  paidByType: Readonly<Record<string, bigint>>;
  /** Tổng nghĩa vụ còn lại **theo từng `kind`** (ROOM/PENALTY/EXTRA_SERVICE/RESCHEDULE_FEE): người tiêu
   * thụ lấy đúng nghĩa vụ của mình (vd. cọc chặn bởi `ROOM`) mà không bù trừ toàn cục — BR-PAY-02. */
  outstandingByKind: Record<string, bigint>;
  sources: LedgerSource[];
  charges: { id: string; outstanding: bigint }[];
}
export interface RefundLeg {
  paymentId: string;
  amount: bigint;
}
