/**
 * DTO chi bồi thường (HB-120 AC13, F6-D06): client **không** khai `amount` — số tiền lấy từ
 * `RoomMove.compensationAmount` đã duyệt. Trường `amount` nếu có bị bỏ qua (không mass-assign).
 */
import { z } from 'zod';
import { compensationPaymentCreateRequestSchema } from '@pinehill/contracts';
import type { CompensationPaymentCreateRequest } from '@pinehill/contracts';
import { invalid, parse } from '../support.js';

const payoutShape = z.object({
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  evidenceRefs: z.array(z.string().min(1)).max(10).optional(),
  bankReference: z.string().trim().min(1).max(64).optional(),
  note: z.string().max(500).optional(),
  pinToken: z.string().min(16).optional(),
  /** Bị bỏ qua có chủ đích: server dùng số đã duyệt trên RoomMove. */
  amount: z.number().int().min(0).optional(),
});

export interface CompensationCommand extends CompensationPaymentCreateRequest {
  readonly amount?: number;
}

export function compensationInput(value: unknown): CompensationCommand {
  const command = parse(payoutShape, value);
  const contract = compensationPaymentCreateRequestSchema.safeParse({
    method: command.method,
    ...(command.evidenceRefs === undefined ? {} : { evidenceRefs: command.evidenceRefs }),
    ...(command.bankReference === undefined ? {} : { bankReference: command.bankReference }),
    ...(command.note === undefined ? {} : { note: command.note }),
    ...(command.pinToken === undefined ? {} : { pinToken: command.pinToken }),
  });
  if (!contract.success) throw invalid('Lệnh chi bồi thường không đúng hợp đồng OVER.');
  return { ...contract.data, ...(command.amount === undefined ? {} : { amount: command.amount }) };
}
