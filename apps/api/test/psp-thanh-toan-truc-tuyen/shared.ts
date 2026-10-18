/**
 * Khẳng định dùng chung của hai ca tích hợp HB-094 (`online-payment`, `payment-status`):
 * đọc hàng `payments`/`bookings` từ CSDL và parse zod (QT §2: không `as`).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { errorBodySchema } from '@pinehill/contracts';
import { rows } from './fixture.js';

export const codeOf = (body: unknown): string => errorBodySchema.parse(body).code;

const paymentRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  type: z.string(),
  method: z.string(),
  amount: z.string(),
  idempotency_key: z.string(),
  provider_txn_id: z.string().nullable(),
  created_by: z.string().nullable(),
});

/** BR-PAY-04: dòng `payments` chỉ mang mã/tiền/trạng thái — cột thẻ không tồn tại trong csdl §3. */
export type PaymentRow = z.infer<typeof paymentRowSchema>;

export async function paymentRow(id: string): Promise<PaymentRow> {
  const parsed = await rows(
    `SELECT id,idempotency_key,provider_txn_id,created_by,status,type,method,amount::text AS amount
       FROM payments WHERE id=$1::uuid`,
    [id],
  );
  return z.array(paymentRowSchema).parse(parsed)[0]!;
}

const bookingRowSchema = z.object({
  status: z.string(),
  hold_expires_at: z.date().nullable(),
});

export async function bookingHold(id: string): Promise<z.infer<typeof bookingRowSchema>> {
  const parsed = await rows('SELECT status, hold_expires_at FROM bookings WHERE id=$1::uuid', [id]);
  return z.array(bookingRowSchema).parse(parsed)[0]!;
}

/** `Idempotency-Key` hợp lệ của lệnh — là chính `orderRef`/`payments.idempotency_key` (BR-PAY-03). */
export const nextKey = () => randomUUID();

/** Dòng audit của lệnh; lấy theo `entity_id` = paymentId để không trộn ca khác. */
const auditRowSchema = z.object({
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  after_json: z.record(z.string(), z.unknown()).nullable(),
});

export type AuditRow = z.infer<typeof auditRowSchema>;

export async function auditOf(paymentId: string): Promise<AuditRow[]> {
  const parsed = await rows(
    `SELECT action,entity_type,entity_id,after_json FROM audit_logs
      WHERE entity_type='Payment' AND entity_id=$1::uuid`,
    [paymentId],
  );
  return z.array(auditRowSchema).parse(parsed);
}
