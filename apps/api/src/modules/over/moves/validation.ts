/**
 * DTO lệnh điều chuyển. Hợp đồng HB-120 là chuẩn (`roomMoveCreateRequestSchema`); bộ test khoá
 * HB-124 gửi kèm `forceMajeure` và chứng từ walk-out dạng phẳng, nên tệp này **chuẩn hoá** hai
 * hình dạng đó rồi vẫn kiểm lại bằng hợp đồng trước khi ghi.
 */
import { z } from 'zod';
import {
  moveTypeSchema,
  roomMoveApproveRequestSchema,
  roomMoveConsentSchema,
  roomMoveCreateRequestSchema,
  roomMoveExecuteRequestSchema,
  walkOutEvidenceSchema,
} from '@pinehill/contracts';
import type {
  RoomMoveApproveRequest,
  RoomMoveExecuteRequest,
  WalkOutEvidence,
} from '@pinehill/contracts';
import { invalid, parse } from '../support.js';

const flatMoveSchema = z.object({
  overbookingCaseId: z.string().min(1).optional(),
  bookingId: z.string().min(1),
  bookingRoomId: z.string().min(1),
  moveType: moveTypeSchema,
  toRoomId: z.string().min(1).optional(),
  toPropertyId: z.string().min(1).optional(),
  reason: z.string().trim().min(1).max(500),
  compensationAmount: z.number().int().safe().min(0),
  transportCost: z.number().int().safe().min(0),
  consent: roomMoveConsentSchema.optional(),
  /** Bất khả kháng: bắt buộc duyệt MANAGER khi khách đã CHECKED_IN (BR-OVER-09, F6-D04). */
  forceMajeure: z.boolean().optional(),
  walkOutDocNo: z.string().trim().min(1).max(64).optional(),
  guestSignatureRef: z.string().min(1).max(128).optional(),
  staffSignatureRef: z.string().min(1).max(128).optional(),
  /** Hình dạng hợp đồng công bố (SCR-44 gửi) — HB-222: trước đây bị bỏ êm vì schema không khai báo. */
  walkOut: walkOutEvidenceSchema.optional(),
});

export type MoveCommand = z.infer<typeof flatMoveSchema>;

export interface NormalizedMove extends Omit<MoveCommand, 'walkOut'> {
  readonly walkOut: WalkOutEvidence | null;
}

/** Chứng từ dạng phẳng của harness HB-124; thiếu một trong ba thì coi như không có. */
function flatEvidence(command: MoveCommand): WalkOutEvidence | null {
  if (
    command.walkOutDocNo === undefined ||
    command.guestSignatureRef === undefined ||
    command.staffSignatureRef === undefined
  )
    return null;
  return {
    walkOutDocNo: command.walkOutDocNo,
    guestSignatureRef: command.guestSignatureRef,
    staffSignatureRef: command.staffSignatureRef,
    refundRequestId: null,
    compensationPaymentId: null,
  };
}

const sameDocuments = (a: WalkOutEvidence, b: WalkOutEvidence): boolean =>
  a.walkOutDocNo === b.walkOutDocNo &&
  a.guestSignatureRef === b.guestSignatureRef &&
  a.staffSignatureRef === b.staffSignatureRef;

/**
 * Nhận cả `walkOut` lồng (hợp đồng) lẫn trường phẳng (HB-124). Hai dạng cùng có mà khác nhau là mơ hồ ⇒
 * 400. `refundRequestId`/`compensationPaymentId` do máy chủ gắn khi thực thi, không nhận từ client.
 */
function evidenceOf(command: MoveCommand): WalkOutEvidence | null {
  const flat = flatEvidence(command);
  if (command.walkOut === undefined) return flat;
  const nested: WalkOutEvidence = {
    walkOutDocNo: command.walkOut.walkOutDocNo,
    guestSignatureRef: command.walkOut.guestSignatureRef,
    staffSignatureRef: command.walkOut.staffSignatureRef,
    refundRequestId: null,
    compensationPaymentId: null,
  };
  if (flat !== null && !sameDocuments(flat, nested))
    throw invalid('Chứng từ walk-out gửi hai dạng không khớp nhau.');
  return nested;
}

export function moveCreateInput(value: unknown): NormalizedMove {
  const command = parse(flatMoveSchema, value);
  const walkOut = evidenceOf(command);
  const consent = command.consent ?? { granted: true, channel: 'IN_PERSON' as const };
  const contract = roomMoveCreateRequestSchema.safeParse({
    ...(command.overbookingCaseId === undefined
      ? {}
      : { overbookingCaseId: command.overbookingCaseId }),
    bookingId: command.bookingId,
    bookingRoomId: command.bookingRoomId,
    moveType: command.moveType,
    ...(command.toRoomId === undefined ? {} : { toRoomId: command.toRoomId }),
    ...(command.toPropertyId === undefined ? {} : { toPropertyId: command.toPropertyId }),
    reason: command.reason,
    compensationAmount: command.compensationAmount,
    transportCost: command.transportCost,
    consent,
    ...(walkOut === null ? {} : { walkOut }),
  });
  if (!contract.success) throw invalid('Lệnh điều chuyển không đúng hợp đồng OVER.');
  return { ...command, consent, walkOut };
}

export function moveApproveInput(value: unknown): RoomMoveApproveRequest {
  return parse(roomMoveApproveRequestSchema, value);
}

export function moveExecuteInput(value: unknown): RoomMoveExecuteRequest {
  return parse(roomMoveExecuteRequestSchema, value);
}

/** Dùng cho `@Idempotent` tiền kiểm: chỉ cần thân lệnh hợp lệ trước khi claim khoá. */
export const moveCreateForAccess = (value: unknown): MoveCommand => parse(flatMoveSchema, value);
export const moveApproveForAccess = moveApproveInput;

/**
 * Execute: chỉ kiểm **cấu trúc** (object, `pinToken` nếu có) để interceptor so hash và trả
 * `E_SYS_IDEMPOTENCY_KEY_REUSED` trước khi DTO chặt từ chối payload; DTO đầy đủ chạy trong service.
 */
export const moveExecuteForAccess = (value: unknown): RoomMoveExecuteRequest =>
  parse(z.object({ pinToken: z.string().min(16).optional() }), value);
