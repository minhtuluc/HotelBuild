/**
 * Hợp đồng OVER — phần điều chuyển/ghép phòng/chi bồi thường (HB-120 AC6/AC12/AC13).
 * Tách khỏi `overbooking.ts` để giữ mỗi tệp dưới hạn `max-lines`; **không** đổi tên trường.
 *
 * F6-D01: `MERGE_CONNECTING` là **một** booking với hai `BookingRoom` — body chỉ `bookingId` +
 * `roomIdA` + `roomIdB`, không `secondaryBookingId`, không consent. `MERGE_SHARE` vẫn hai booking.
 * F6-D06: chi bồi thường là hợp đồng riêng; client **không** gửi `amount` (lấy từ quyết định đã duyệt).
 */
import { z } from 'zod';
import { isoUtcTimestampSchema } from './common.js';
import {
  guestGenderSchema,
  moveTypeSchema,
  paymentStatusSchema,
  roomMergeSideSchema,
  roomMergeStatusSchema,
  roomMoveStatusSchema,
  compensationPayoutStateSchema,
} from './enums.js';

/** Trạng thái ý định ghi tra theo `Idempotency-Key` khi timeout chưa rõ kết quả (AC12). */
export const writeIntentStateSchema = z.enum(['NOT_FOUND', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED']);

export const writeIntentSchema = z.object({
  idempotencyKey: z.string().uuid(),
  state: writeIntentStateSchema,
  resourceType: z.enum(['ROOM_MOVE', 'ROOM_MERGE', 'RELOCATION_PLAN']),
  resourceId: z.string().min(1).nullable(),
  operationId: z.string().min(1).nullable(),
  recordedAt: isoUtcTimestampSchema.nullable(),
});

/** Tham số tra ý định ghi; vắng thì response trả `writeIntent = null` (không đổi hành vi cũ). */
export const writeIntentQuerySchema = z.strictObject({
  idempotencyKey: z.string().uuid().optional(),
});

/** Bằng chứng walk-out; tham chiếu hồ sơ hoàn/bồi thường do F5 quản lý, F6 không tạo refund riêng. */
export const walkOutEvidenceSchema = z.object({
  walkOutDocNo: z.string().trim().min(1).max(64),
  guestSignatureRef: z.string().min(1).max(128),
  staffSignatureRef: z.string().min(1).max(128),
  refundRequestId: z.string().min(1).nullable(),
  compensationPaymentId: z.string().min(1).nullable(),
});

export const roomMoveConsentSchema = z.strictObject({
  granted: z.boolean(),
  channel: z.enum(['PHONE', 'EMAIL', 'IN_PERSON', 'SYSTEM']),
  evidenceRef: z.string().min(1).max(128).optional(),
  recordedAt: isoUtcTimestampSchema.optional(),
});

/**
 * `POST /room-moves` — lập phương án điều chuyển (FRONT_DESK). `MERGE_*` không đi qua route này;
 * `WALK_OUT` không cần `toRoomId` nhưng phải kèm chứng từ khi thực thi.
 */
export const roomMoveCreateRequestSchema = z
  .strictObject({
    overbookingCaseId: z.string().min(1).optional(),
    bookingId: z.string().min(1),
    bookingRoomId: z.string().min(1),
    moveType: moveTypeSchema,
    toRoomId: z.string().min(1).optional(),
    toPropertyId: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(500),
    /** Chi phí **đề xuất** để MANAGER duyệt; chưa duyệt thì chưa chi (BR-OVER-06). */
    compensationAmount: z.number().int().safe().min(0),
    transportCost: z.number().int().safe().min(0),
    consent: roomMoveConsentSchema,
    walkOut: walkOutEvidenceSchema.optional(),
  })
  .refine((value) => !value.moveType.startsWith('MERGE_'), {
    message: 'Ghép phòng dùng `POST /room-merges`, không dùng `/room-moves`',
    path: ['moveType'],
  })
  .refine((value) => value.moveType === 'WALK_OUT' || value.toRoomId !== undefined, {
    message: 'Điều chuyển thường bắt buộc có `toRoomId`',
    path: ['toRoomId'],
  });

export const roomMoveApproveRequestSchema = z.strictObject({
  compensationAmount: z.number().int().safe().min(0),
  transportCost: z.number().int().safe().min(0),
  note: z.string().max(500).optional(),
  pinToken: z.string().min(16).optional(),
});

export const roomMoveExecuteRequestSchema = z.strictObject({
  pinToken: z.string().min(16).optional(),
});

export const roomMoveBaseSchema = z.object({
  id: z.string().min(1),
  overbookingCaseId: z.string().min(1).nullable(),
  bookingId: z.string().min(1),
  bookingRoomId: z.string().min(1),
  moveType: moveTypeSchema,
  fromRoomId: z.string().min(1).nullable(),
  toRoomId: z.string().min(1).nullable(),
  fromPropertyId: z.string().min(1).nullable(),
  toPropertyId: z.string().min(1).nullable(),
  reason: z.string().min(1),
  keepScore: z.number().int().min(0).max(173),
  /** Luôn `true`: khách giữ đơn giá đã chốt cho toàn kỳ (BR-OVER-08). */
  priceLocked: z.literal(true),
  compensationAmount: z.number().int().safe().min(0),
  transportCost: z.number().int().safe().min(0),
  consent: roomMoveConsentSchema.nullable(),
  approvedBy: z.string().min(1).nullable(),
  approvedAt: isoUtcTimestampSchema.nullable(),
  status: roomMoveStatusSchema,
  assignmentIds: z.array(z.string().min(1)),
  walkOut: walkOutEvidenceSchema.nullable(),
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  version: z.number().int().min(0),
});

/** `RoomMove` trả về; walk-out đã thực thi **phải** có chứng từ (csdl `ck_room_moves_walkout_doc`). */
export const roomMoveSchema = roomMoveBaseSchema.refine(
  (value) => value.moveType !== 'WALK_OUT' || value.status !== 'EXECUTED' || value.walkOut !== null,
  { message: 'Walk-out đã thực thi phải có `walkOut` kèm chứng từ/chữ ký', path: ['walkOut'] },
);

/**
 * `POST /room-merges` — D01: body SHARE giữ `primaryBookingId`/`secondaryBookingId`/`roomId`;
 * body CONNECTING chỉ có `bookingId` + `roomIdA` + `roomIdB` (không `secondaryBookingId`, không consent).
 * `discountPct` chỉ là đề xuất; server áp chính sách 20% SHARE / 10% CONNECTING (BR-OVER-15).
 */
export const roomMergeRequestSchema = z
  .discriminatedUnion('moveType', [
    z.strictObject({
      moveType: z.literal('MERGE_SHARE'),
      primaryBookingId: z.string().min(1),
      secondaryBookingId: z.string().min(1),
      roomId: z.string().min(1),
      discountPct: z.number().int().min(0).max(100).optional(),
    }),
    z.strictObject({
      moveType: z.literal('MERGE_CONNECTING'),
      bookingId: z.string().min(1),
      roomIdA: z.string().min(1),
      roomIdB: z.string().min(1),
      discountPct: z.number().int().min(0).max(100).optional(),
    }),
  ])
  .refine(
    (value) =>
      value.moveType !== 'MERGE_SHARE' || value.primaryBookingId !== value.secondaryBookingId,
    { message: 'MERGE_SHARE cần hai booking khác nhau', path: ['secondaryBookingId'] },
  )
  .refine((value) => value.moveType !== 'MERGE_CONNECTING' || value.roomIdA !== value.roomIdB, {
    message: 'Hai phòng connecting phải khác nhau',
    path: ['roomIdB'],
  });

/** `POST /room-merges/{id}/consent` — chỉ có nghĩa với SHARE (D01); CONNECTING không có consent. */
export const roomMergeConsentRequestSchema = z.strictObject({
  side: roomMergeSideSchema,
  consented: z.boolean(),
  evidenceUrl: z.string().min(1).max(2048).optional(),
});

export const roomMergeApproveRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export const roomMergeBaseSchema = z.object({
  id: z.string().min(1),
  moveType: z.enum(['MERGE_SHARE', 'MERGE_CONNECTING']),
  /** SHARE: hai booking độc lập. CONNECTING: cùng `primaryBookingId`, `secondaryBookingId = null`. */
  primaryBookingId: z.string().min(1),
  secondaryBookingId: z.string().min(1).nullable(),
  roomId: z.string().min(1).nullable(),
  roomIdA: z.string().min(1).nullable(),
  roomIdB: z.string().min(1).nullable(),
  consents: z.array(
    z.object({
      side: roomMergeSideSchema,
      consented: z.boolean(),
      evidenceUrl: z.string().min(1).max(2048).nullable(),
      recordedBy: z.string().min(1),
      recordedAt: isoUtcTimestampSchema,
    }),
  ),
  /** `null` với CONNECTING: một booking nên không có so sánh hai bên (F6-D01). */
  genderSame: z.boolean().nullable(),
  approvedBy: z.string().min(1).nullable(),
  approvedAt: isoUtcTimestampSchema.nullable(),
  discountPct: z.number().int().min(0).max(100),
  /** Chiết khấu ghi riêng; doanh thu/`PriceSnapshot` không đổi (BR-OVER-15, F6-D03). */
  discountAmount: z.number().int().safe().min(0),
  priceLocked: z.literal(true),
  status: roomMergeStatusSchema,
  createdAt: isoUtcTimestampSchema,
  updatedAt: isoUtcTimestampSchema,
  version: z.number().int().min(0),
});

/** Hình dạng theo D01: SHARE hai booking/một phòng; CONNECTING một booking/hai phòng thông nhau. */
export const roomMergeSchema = roomMergeBaseSchema
  .refine(
    (value) =>
      value.moveType !== 'MERGE_SHARE' ||
      (value.secondaryBookingId !== null && value.roomId !== null),
    { message: 'MERGE_SHARE cần hai booking và một `roomId`', path: ['secondaryBookingId'] },
  )
  .refine(
    (value) =>
      value.moveType !== 'MERGE_CONNECTING' ||
      (value.secondaryBookingId === null && value.roomIdA !== null && value.roomIdB !== null),
    { message: 'MERGE_CONNECTING dùng một booking với `roomIdA`/`roomIdB`', path: ['roomIdA'] },
  );

export const roomMoveActionSchema = z.enum(['APPROVE', 'EXECUTE', 'CANCEL']);
export const roomMergeActionSchema = z.enum(['RECORD_CONSENT', 'APPROVE', 'EXECUTE', 'CANCEL']);

/** `GET /room-moves/{roomMoveId}` — bàn giao/đối soát cho FRONT_DESK/MANAGER/OWNER có scope (AC12). */
export const roomMoveViewSchema = roomMoveBaseSchema.extend({
  allowedActions: z.array(roomMoveActionSchema),
  writeIntent: writeIntentSchema.nullable(),
});

/** `GET /room-merges/{roomMergeId}` — chứng từ đã che + hành động được phép (AC12). */
export const roomMergeViewSchema = roomMergeBaseSchema.extend({
  allowedActions: z.array(roomMergeActionSchema),
  writeIntent: writeIntentSchema.nullable(),
});

/** Phương thức chi bồi thường: chi tay có bằng chứng, không mở adapter PSP mới (F6-D06). */
export const compensationPaymentMethodSchema = z.enum(['CASH', 'BANK_TRANSFER']);

/**
 * `POST /room-moves/{roomMoveId}/compensation-payments` — ACCOUNTANT + PIN + `Idempotency-Key`.
 * **Không** có `amount`: số tiền lấy từ `RoomMove.compensationAmount` đã duyệt (D06, AC13).
 * Cần ít nhất một bằng chứng (`evidenceRefs`, `bankReference`) hoặc `note` làm intent của adapter chi.
 */
export const compensationPaymentCreateRequestSchema = z
  .strictObject({
    method: compensationPaymentMethodSchema,
    evidenceRefs: z.array(z.string().min(1)).max(10).optional(),
    /** Bắt buộc với `BANK_TRANSFER` (mô hình chứng từ của `confirm-transfer`). */
    bankReference: z.string().trim().min(1).max(64).optional(),
    note: z.string().max(500).optional(),
    pinToken: z.string().min(16).optional(),
  })
  .refine((value) => value.method !== 'BANK_TRANSFER' || value.bankReference !== undefined, {
    message: '`BANK_TRANSFER` bắt buộc có `bankReference`',
    path: ['bankReference'],
  })
  .refine(
    (value) =>
      (value.evidenceRefs ?? []).length > 0 ||
      value.bankReference !== undefined ||
      (value.note ?? '').trim().length > 0,
    {
      message: 'Cần `evidenceRefs`, `bankReference` hoặc `note` làm bằng chứng chi',
      path: ['note'],
    },
  );

/**
 * Khoản chi bồi thường. `state` tách `UNKNOWN` (timeout chưa rõ kết quả) khỏi `SUCCEEDED`; `id` +
 * `operationId` là định danh **bền** để tra lại, không tạo lần chi mới (D06).
 */
export const compensationPaymentSchema = z.object({
  id: z.string().min(1),
  roomMoveId: z.string().min(1),
  bookingId: z.string().min(1),
  amount: z.number().int().safe().min(0),
  currency: z.literal('VND'),
  type: z.literal('COMPENSATION'),
  method: compensationPaymentMethodSchema,
  state: compensationPayoutStateSchema,
  paymentStatus: paymentStatusSchema,
  operationId: z.string().min(1),
  approvalRef: z.object({ approvedBy: z.string().min(1), approvedAt: isoUtcTimestampSchema }),
  bankReference: z.string().nullable(),
  evidenceRefs: z.array(z.string().min(1)),
  createdBy: z.string().min(1),
  createdAt: isoUtcTimestampSchema,
  paidAt: isoUtcTimestampSchema.nullable(),
});

export const compensationPaymentsViewSchema = z.object({
  roomMoveId: z.string().min(1),
  /** Số tiền đã duyệt trên `RoomMove`; mọi khoản chi phải khớp đúng số này. */
  approvedAmount: z.number().int().safe().min(0),
  payments: z.array(compensationPaymentSchema),
});

/** Giới tính khách dùng cho kiểm tra BR-OVER-14; `UNSPECIFIED` coi như khác giới. */
export const mergeGenderSchema = guestGenderSchema;

export type WalkOutEvidence = z.infer<typeof walkOutEvidenceSchema>;
export type RoomMoveConsent = z.infer<typeof roomMoveConsentSchema>;
export type RoomMoveCreateRequest = z.infer<typeof roomMoveCreateRequestSchema>;
export type RoomMoveApproveRequest = z.infer<typeof roomMoveApproveRequestSchema>;
export type RoomMoveExecuteRequest = z.infer<typeof roomMoveExecuteRequestSchema>;
export type RoomMove = z.infer<typeof roomMoveSchema>;
export type RoomMoveView = z.infer<typeof roomMoveViewSchema>;
export type RoomMergeRequest = z.infer<typeof roomMergeRequestSchema>;
export type RoomMergeConsentRequest = z.infer<typeof roomMergeConsentRequestSchema>;
export type RoomMergeApproveRequest = z.infer<typeof roomMergeApproveRequestSchema>;
export type RoomMerge = z.infer<typeof roomMergeSchema>;
export type RoomMergeView = z.infer<typeof roomMergeViewSchema>;
export type WriteIntent = z.infer<typeof writeIntentSchema>;
export type CompensationPaymentMethod = z.infer<typeof compensationPaymentMethodSchema>;
export type CompensationPaymentCreateRequest = z.infer<
  typeof compensationPaymentCreateRequestSchema
>;
export type CompensationPayment = z.infer<typeof compensationPaymentSchema>;
export type CompensationPaymentsView = z.infer<typeof compensationPaymentsViewSchema>;
