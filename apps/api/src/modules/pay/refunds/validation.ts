/** Cổng vào/ra của module hoàn tiền (HB-099). Mã lỗi lấy đúng bộ đã chốt ở api.md §4.2. */
import { z } from 'zod';
import {
  refundApproveRequestSchema,
  refundCancelRequestSchema,
  refundRejectRequestSchema,
  refundRequestCreateRequestSchema,
  type RefundApproveRequest,
  type RefundCancelRequest,
  type RefundRejectRequest,
  type RefundRequestCreateRequest,
} from '@pinehill/contracts';
import type { ErrorCode } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { isAuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { FastifyRequest } from 'fastify';

/** Bảng lỗi của module: mọi nhánh từ chối đi qua đây để mã HTTP/mã lỗi không trôi khỏi hợp đồng. */
const ERRORS = {
  missing: [404, 'E_GEN_NOT_FOUND', 'Không tìm thấy hồ sơ hoàn tiền.'],
  invalid: [400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu hoàn tiền không hợp lệ.'],
  forbidden: [403, 'E_RBAC_FORBIDDEN', 'Bạn không được thao tác hoàn tiền.'],
  notPending: [409, 'E_PAY_REFUND_NOT_PENDING', 'Hồ sơ không còn ở trạng thái chờ duyệt.'],
  selfApproval: [403, 'E_PAY_SELF_APPROVAL', 'Người duyệt phải khác người lập hồ sơ.'],
  amountMismatch: [422, 'E_PAY_AMOUNT_MISMATCH', 'Số tiền duyệt không hợp lệ.'],
  exceedsPaid: [422, 'E_PAY_REFUND_EXCEEDS_PAID', 'Tiền hoàn vượt số đã thu đủ điều kiện.'],
  forceMajeure: [
    403,
    'E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN',
    'Chỉ MANAGER/OWNER được lập hồ sơ hoàn bất khả kháng.',
  ],
  reasonTooShort: [400, 'E_PAY_REASON_TOO_SHORT', 'Lý do bất khả kháng cần ≥ 20 ký tự.'],
  /** Booking chưa ở trạng thái mà engine huỷ/hoàn mô hình hoá được (BR-CANCEL-01…07). */
  notEligible: [409, 'E_CANCEL_NOT_ALLOWED', 'Booking không ở trạng thái có thể lập hoàn tiền.'],
} as const satisfies Record<string, readonly [number, ErrorCode, string]>;

export type RefundErrorCode = keyof typeof ERRORS;

export function refundError(code: RefundErrorCode, message?: string): AppError {
  const [status, errorCode, fallback] = ERRORS[code];
  return new AppError(status, errorCode, message ?? fallback);
}

const uuidSchema = z.uuid().transform((s) => s.toLowerCase());

/** ID đường dẫn/nguồn thu không phải UUID hợp lệ thì coi như không tồn tại (api.md §1). */
export function refundId(value: unknown): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw refundError('missing');
  return result.data;
}

/** DB có CHECK `NOT is_force_majeure OR reason = 'FORCE_MAJEURE'`; chặn sớm tại cổng vào. */
function checkReasonPair(reason: string, isForceMajeure: boolean): void {
  if (isForceMajeure !== (reason === 'FORCE_MAJEURE')) throw refundError('invalid');
}

export function createInput(value: unknown): RefundRequestCreateRequest {
  const result = refundRequestCreateRequestSchema.safeParse(value);
  if (!result.success) throw refundError('invalid');
  checkReasonPair(result.data.reason, result.data.isForceMajeure);
  refundId(result.data.bookingId);
  refundId(result.data.paymentId);
  return result.data;
}

export function approveInput(value: unknown): RefundApproveRequest {
  const result = refundApproveRequestSchema.safeParse(value);
  if (!result.success) throw refundError('invalid');
  return result.data;
}

export function rejectInput(value: unknown): RefundRejectRequest {
  const result = refundRejectRequestSchema.safeParse(value);
  if (!result.success) throw refundError('invalid');
  return result.data;
}

export function cancelInput(value: unknown): RefundCancelRequest {
  const result = refundCancelRequestSchema.safeParse(value);
  if (!result.success) throw refundError('invalid');
  return result.data;
}

/** Khoá chống trùng đã được `identifyRequest` kiểm là UUID; dùng lại làm `event_key` ổn định. */
export function commandKey(value: unknown): string {
  if (typeof value !== 'string' || !z.uuid().safeParse(value).success) throw refundError('invalid');
  return value.toLowerCase();
}

export function requestActor(request: FastifyRequest) {
  if (!isAuthorizedActor(request.actor)) throw refundError('forbidden', 'Chưa xác thực.');
  return request.actor;
}
