/**
 * Ghi atom của `POST /payments/online` (AC1, AC3) — **chỉ** chạy trong transaction do `IdempotencyStore`
 * (HB-029) mở, cùng chỗ với bản sao phản hồi và hàng `idempotency_keys`:
 * `payments` (PENDING) + `audit_logs`. Cùng transaction nên hoặc cả hai cùng có, hoặc không dòng nào.
 *
 * Lệnh **không** chạm `bookings`: khởi tạo thanh toán không gia hạn hold (AC2/ADR-014) — hạn giữ chỗ vẫn
 * do `bookings.hold_expires_at` và job HB-078 quyết định. Không gọi mạng: adapter chỉ dựng URL đã ký,
 * đúng cách VNPay v2/MoMo v2 chuyển hướng khách (xem `pay/psp/port.ts`).
 */
import type { Prisma as PrismaTypes } from '@prisma/client';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import type { BookingCaller } from '../../book/bookings/principal.js';
import type { PspMethod } from '../psp/port.js';
import { paymentSelect } from './projection.js';
import type { OnlineType } from './validation.js';
import type { PaymentRow } from './projection.js';

type Tx = PrismaTypes.TransactionClient;

export interface OnlinePaymentWrite {
  readonly bookingId: string;
  readonly propertyId: string;
  readonly type: OnlineType;
  readonly method: PspMethod;
  readonly amount: bigint;
  /** `orderRef` bền = `Idempotency-Key` của lệnh; BR-PAY-03 đối chiếu callback bằng chính khoá này. */
  readonly orderRef: string;
  readonly caller: BookingCaller;
  /** Giờ CSDL đọc sau khi khoá (ADR-014). */
  readonly now: Date;
}

export async function insertOnlinePayment(
  tx: Tx,
  audit: AuditWriter,
  write: OnlinePaymentWrite,
): Promise<PaymentRow> {
  const row = await tx.payments.create({
    data: {
      booking_id: write.bookingId,
      type: write.type,
      method: write.method,
      amount: write.amount,
      status: 'PENDING',
      // UNIQUE `(booking_id, type, idempotency_key)` của csdl §3: một lệnh ⇒ đúng một Payment (§5.2).
      idempotency_key: write.orderRef,
      // Phiên khách không có `users.id` để ghi (BR-PAY-06 chỉ buộc với tiền mặt).
      created_by: write.caller.type === 'USER' ? write.caller.id : null,
      created_at: write.now,
      updated_at: write.now,
    },
    select: paymentSelect,
  });
  await audit.record(tx, {
    actor: {
      id: write.caller.type === 'USER' ? write.caller.id : null,
      role: write.caller.role,
      ip: write.caller.ip,
      correlationId: write.caller.correlationId,
    },
    action: 'PAYMENT_ONLINE_INITIATED',
    entityType: 'Payment',
    entityId: row.id,
    beforeJson: null,
    afterJson: {
      bookingId: write.bookingId,
      propertyId: write.propertyId,
      type: write.type,
      method: write.method,
      // Tiền là chuỗi thập phân trong nhật ký, như `BookingLedger` đang làm.
      amount: write.amount.toString(),
      status: 'PENDING',
      orderRef: write.orderRef,
    },
    // Không có lý do tự do; **không** ghi tham số chữ ký/tham số cổng vào nhật ký (BR-PAY-04, NFR-SEC-02).
    reason: null,
  });
  return row;
}
