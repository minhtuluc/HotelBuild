/**
 * Hợp đồng OVER — api.md §2.8, §3.9–3.10, §6.3; HB-120.
 *
 * Chỉ mô tả dữ liệu trao đổi. Luật tồn/tiền/phê duyệt/xếp hạng do backend (`OverbookingPlanner`,
 * `evaluateRoomMerge`, `walkOutPolicy`) cưỡng chế; hợp đồng **không** nhận trường máy chủ quyết
 * (`approvedBy`, `keepScore`, `priceLocked`, `oversold`) hay tổng tiền client tự tính (AC3).
 * Phần điều chuyển/ghép phòng/chi bồi thường nằm ở `overbooking-move.ts`, re-export bên dưới.
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema, listQuerySchema } from './common.js';
import {
  bookingStatusSchema,
  channelCodeSchema,
  moveTypeSchema,
  overbookingCaseStatusSchema,
  overbookingResolutionSourceSchema,
  overbookingScanStatusSchema,
  relocationPriorityGroupSchema,
  type MoveType,
} from './enums.js';
import { writeIntentSchema } from './overbooking-move.js';

export * from './overbooking-move.js';

/** `Booking.seq` là `bigint`: transport mang **chuỗi thập phân** để không mất chính xác (AC3). */
export const bookingSeqSchema = z
  .string()
  .regex(/^\d+$/, '`seq` phải là chuỗi số nguyên thập phân (bigint)');

/** Bốn bậc thang xử lý theo BR-OVER-06 §9.2; thứ tự cố định bậc 1 → 2 → 3 → 4. */
export const LADDER_MOVE_TYPES: readonly (readonly MoveType[])[] = [
  ['SAME_TYPE_SAME_PROPERTY'],
  ['UPGRADE_SAME_PROPERTY'],
  ['SAME_TYPE_CROSS_PROPERTY', 'UPGRADE_CROSS_PROPERTY'],
  ['WALK_OUT'],
];

export const relocationLadderStepSchema = z.object({
  step: z.number().int().min(1).max(4),
  moveType: moveTypeSchema,
  feasible: z.boolean(),
  candidateCount: z.number().int().min(0),
  /** Bậc không khả dụng **phải** nêu lý do (bậc 3 hiện tại: ba cơ sở cách nhau 160–300 km). */
  note: z.string().min(1).optional(),
});

/**
 * Thang 4 bậc. Bậc 3 (`SAME_TYPE_CROSS_PROPERTY`/`UPGRADE_CROSS_PROPERTY`) hiện trả
 * `feasible = false` kèm lý do khoảng cách; hệ thống vẫn trả **đủ bốn bậc** (BR-OVER-06, AC5).
 */
export const relocationLadderSchema = z
  .array(relocationLadderStepSchema)
  .length(4)
  .refine(
    (steps) =>
      steps.every(
        (step, index) =>
          step.step === index + 1 && (LADDER_MOVE_TYPES[index] ?? []).includes(step.moveType),
      ),
    { message: 'Thang phải đúng thứ tự 4 bậc và đúng `moveType` của từng bậc' },
  )
  .refine((steps) => steps.every((step) => step.feasible || (step.note ?? '').length > 0), {
    message: 'Bậc không khả dụng phải nêu lý do',
  });

/**
 * Phân rã `keepScore` theo BR §9.3 + F6-D08. `total` **phải** bằng tổng các thành phần; thứ tự sắp
 * `keepScore` ↑ → `createdAt` ↓ → `Booking.seq` ↑ (BR-OVER-11).
 */
export const keepScoreBreakdownSchema = z
  .object({
    total: z.number().int().min(0).max(173),
    /** PLATINUM 100 · GOLD 80 · SILVER 50 · MEMBER 20 · GUEST 0. */
    loyaltyTier: z.number().int().min(0).max(100),
    /** 0/10/20 theo nhánh thanh toán của F6-D08. */
    payment: z.number().int().min(0).max(20),
    /** `min(số đêm, 14) × 2`. */
    nights: z.number().int().min(0).max(28),
    returningGuest: z.number().int().min(0).max(15),
    arrived: z.number().int().min(0).max(10),
  })
  .refine(
    (value) =>
      value.total ===
      value.loyaltyTier + value.payment + value.nights + value.returningGuest + value.arrived,
    { message: '`total` phải bằng tổng các thành phần keepScore', path: ['total'] },
  );

/**
 * Ứng viên điều chuyển đã xếp hạng. Che PII: chỉ tên đã che; `seq` là chuỗi; `rank` do server đặt —
 * client **không** dùng UUID để tie-break (BR-OVER-11, AC5).
 */
export const relocationCandidateSchema = z.object({
  rank: z.number().int().min(1),
  bookingId: z.string().min(1),
  bookingRoomId: z.string().min(1),
  bookingSeq: bookingSeqSchema,
  guestNameMasked: z.string().min(1),
  channelCode: channelCodeSchema,
  status: bookingStatusSchema,
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  nights: z.number().int().min(1),
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  keepScore: keepScoreBreakdownSchema,
  /** `WEAK` = WALKIN chưa trả tiền hoặc HELD (BR-OVER-12); nhóm yếu luôn bị điều chuyển trước. */
  priorityGroup: relocationPriorityGroupSchema,
  createdAt: isoUtcTimestampSchema,
  paidAmount: z.number().int().safe().min(0),
  depositAmount: z.number().int().safe().min(0),
  totalAmount: z.number().int().safe().min(0),
});

/**
 * Ứng viên trong **chi tiết ca** (`GET /overbooking-cases/{id}?includeCandidates=true`, HB-126): điểm là
 * số `keepScore` kèm `keepScoreBreakdown` của bộ chọn ca (khác `relocationCandidateSchema` của
 * `relocation-plan`, nơi `keepScore` là bảng phân rã của planner HB-122). Thứ tự và `rank` do server đặt.
 */
export const overbookingCaseCandidateSchema = z.object({
  rank: z.number().int().min(1),
  bookingId: z.string().min(1),
  bookingRoomId: z.string().min(1),
  bookingSeq: bookingSeqSchema,
  guestNameMasked: z.string().min(1),
  channelCode: channelCodeSchema,
  status: bookingStatusSchema,
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  nights: z.number().int().min(1),
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  keepScore: z.number().int().min(0),
  keepScoreBreakdown: z.object({
    loyalty: z.number().int().min(0),
    payment: z.number().int().min(0),
    nights: z.number().int().min(0),
    repeat: z.number().int().min(0),
    arrived: z.number().int().min(0),
  }),
  priorityGroup: relocationPriorityGroupSchema,
  createdAt: isoUtcTimestampSchema,
  paidAmount: z.number().int().safe().min(0),
  depositAmount: z.number().int().safe().min(0),
  totalAmount: z.number().int().safe().min(0),
});

/** Một dòng lịch sử xử lý ca quá tải (AC5). */
export const overbookingCaseEventSchema = z.object({
  at: isoUtcTimestampSchema,
  action: z.enum(['DETECTED', 'PLAN_PROPOSED', 'ESCALATED', 'RESOLVED', 'REOPENED']),
  actorId: z.string().min(1).nullable(),
  note: z.string().nullable(),
});

/** Ca quá tải ở mức danh sách (api.md §3.9). `overdue` do server tính, deadline = T−24h. */
export const overbookingCaseSummarySchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  date: businessDateSchema,
  roomTypeId: z.string().min(1),
  roomTypeCode: z.string().min(1).optional(),
  shortageCount: z.number().int().min(0),
  status: overbookingCaseStatusSchema,
  detectedAt: isoUtcTimestampSchema,
  resolveDeadline: isoUtcTimestampSchema,
  escalatedAt: isoUtcTimestampSchema.nullable(),
  overdue: z.boolean(),
  resolvedAt: isoUtcTimestampSchema.nullable(),
  /** `null` khi ca do job hệ thống đóng (`resolutionSource = SYSTEM`, F6-D07). */
  resolvedBy: z.string().min(1).nullable(),
  resolutionSource: overbookingResolutionSourceSchema.nullable(),
  delayReason: z.string().nullable(),
  affectedBookingIds: z.array(z.string().min(1)),
  ladderPreview: relocationLadderSchema,
  version: z.number().int().min(0),
});

/**
 * Metadata độ tươi của lần quét để UI phân biệt "rỗng thật" với "chưa quét/scan lỗi" (AC14), đúng
 * hình dạng server trả từ `overbooking_scan_runs` (HB-126, HB-220): `NEVER` = chưa từng quét;
 * `lastSuccessAt`/`dataAsOf` chỉ đổi sau lượt thành công và **giữ** mốc cũ khi lượt sau lỗi.
 */
export const overbookingScanMetadataSchema = z.object({
  status: overbookingScanStatusSchema,
  lastSuccessAt: isoUtcTimestampSchema.nullable(),
  dataAsOf: isoUtcTimestampSchema.nullable(),
});

export const overbookingCaseListSchema = z.object({
  data: z.array(overbookingCaseSummarySchema),
  meta: z.strictObject({
    limit: z.number().int().min(1).max(100),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    total: z.number().int().min(0).optional(),
    overdueCount: z.number().int().min(0),
    scan: overbookingScanMetadataSchema,
  }),
});

/** Chi tiết ca + ứng viên đã xếp hạng + lịch sử xử lý (api.md §3.9, AC5). */
export const overbookingCaseDetailSchema = overbookingCaseSummarySchema.extend({
  candidates: z.array(overbookingCaseCandidateSchema),
  history: z.array(overbookingCaseEventSchema),
});

export const overbookingCasesQuerySchema = listQuerySchema.extend({
  propertyId: z.string().min(1).optional(),
  status: overbookingCaseStatusSchema.optional(),
  dateFrom: businessDateSchema.optional(),
  dateTo: businessDateSchema.optional(),
  roomTypeId: z.string().min(1).optional(),
  overdueOnly: z.coerce.boolean().optional(),
});

export const overbookingCaseDetailQuerySchema = z.strictObject({
  includeCandidates: z.coerce.boolean().optional(),
});

/**
 * `POST /overbooking-cases/{caseId}/relocation-plan` — tính thang và thứ tự ứng viên. Phản hồi là
 * **phương án** (`status = PROPOSED`), chưa gán phòng và không đổi assignment (api.md §3.10, AC2).
 */
export const relocationPlanRequestSchema = z.strictObject({
  strategy: z.enum(['AUTO', 'MANUAL']),
});

export const relocationPlanSchema = z.object({
  caseId: z.string().min(1),
  propertyId: z.string().min(1),
  date: businessDateSchema,
  roomTypeId: z.string().min(1),
  shortageCount: z.number().int().min(0),
  status: z.literal('PROPOSED'),
  resolveDeadline: isoUtcTimestampSchema,
  overdue: z.boolean(),
  ladder: relocationLadderSchema,
  candidates: z.array(relocationCandidateSchema),
  /** Phương án không tạo/đổi assignment; chỉ lệnh execute mới gán phòng. */
  assignmentsChanged: z.literal(false),
  generatedAt: isoUtcTimestampSchema,
});

/**
 * `POST /overbooking-cases/{caseId}/resolve` — đóng ca. Ca đã `ESCALATED`/quá hạn **vẫn** đóng được
 * sau khi xử lý sự cố tại chỗ; deadline không cấm mọi execute (BR-OVER-16, AC7).
 */
export const overbookingResolveRequestSchema = z.strictObject({
  resolutionNote: z.string().trim().min(1).max(500),
});

export const overbookingResolveResponseSchema = z
  .object({
    caseId: z.string().min(1),
    status: z.literal('RESOLVED'),
    resolutionSource: overbookingResolutionSourceSchema,
    /** Bắt buộc có khi `USER`; `null` khi `SYSTEM` (không tạo user giả — F6-D07). */
    resolvedBy: z.string().min(1).nullable(),
    resolvedAt: isoUtcTimestampSchema,
    resolutionNote: z.string().min(1),
    auditLogId: z.string().min(1),
  })
  .refine(
    (value) =>
      value.resolutionSource === 'SYSTEM' ? value.resolvedBy === null : value.resolvedBy !== null,
    { message: '`resolvedBy` chỉ null khi `resolutionSource = SYSTEM`', path: ['resolvedBy'] },
  );

export const relocationOptionsQuerySchema = z.strictObject({
  overbookingCaseId: z.string().min(1).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

/** Một phương án cho **chính** booking đang tra; không kèm bảng xếp hạng hay PII booking khác. */
export const relocationOptionSchema = z.object({
  moveType: moveTypeSchema,
  feasible: z.boolean(),
  targetPropertyId: z.string().min(1).nullable(),
  targetRoomId: z.string().min(1).nullable(),
  targetRoomTypeId: z.string().min(1).nullable(),
  priceLocked: z.literal(true),
  compensationAmount: z.number().int().safe().min(0),
  transportCost: z.number().int().safe().min(0),
  note: z.string().min(1).optional(),
});

export const bookingRelocationOptionsSchema = z.object({
  bookingId: z.string().min(1),
  overbookingCaseId: z.string().min(1).nullable(),
  date: businessDateSchema.nullable(),
  options: z.array(relocationOptionSchema),
  generatedAt: isoUtcTimestampSchema,
  writeIntent: writeIntentSchema.nullable(),
});

export const overbookingAlertsQuerySchema = listQuerySchema.extend({
  propertyId: z.string().min(1).optional(),
  date: businessDateSchema.optional(),
  overdueOnly: z.coerce.boolean().optional(),
});

/**
 * `GET /overbooking-alerts` — projection tối giản cho FRONT_DESK: chỉ booking cần xử lý trong scope,
 * không `keepScore`, không PII ngoài tên đã che; liên kết chỉ tới hành động được phép (AC12).
 */
export const overbookingAlertSchema = z.object({
  caseId: z.string().min(1),
  propertyId: z.string().min(1),
  date: businessDateSchema,
  shortageCount: z.number().int().min(0),
  status: overbookingCaseStatusSchema,
  overdue: z.boolean(),
  resolveDeadline: isoUtcTimestampSchema,
  bookings: z.array(
    z.object({
      bookingId: z.string().min(1),
      bookingRoomId: z.string().min(1).nullable(),
      guestNameMasked: z.string().min(1),
      checkIn: businessDateSchema,
      checkOut: businessDateSchema,
    }),
  ),
  links: z.array(
    z.object({
      rel: z.enum(['SELF', 'ROOM_MOVE', 'RELOCATION_OPTIONS']),
      href: z.string().min(1),
    }),
  ),
});

export const overbookingAlertsViewSchema = z.object({
  data: z.array(overbookingAlertSchema),
  meta: z.strictObject({
    limit: z.number().int().min(1).max(100),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    scan: overbookingScanMetadataSchema,
  }),
});

export type BookingSeq = z.infer<typeof bookingSeqSchema>;
export type RelocationLadderStep = z.infer<typeof relocationLadderStepSchema>;
export type RelocationLadder = z.infer<typeof relocationLadderSchema>;
export type KeepScoreBreakdown = z.infer<typeof keepScoreBreakdownSchema>;
export type RelocationCandidate = z.infer<typeof relocationCandidateSchema>;
export type OverbookingCaseEvent = z.infer<typeof overbookingCaseEventSchema>;
export type OverbookingCaseSummary = z.infer<typeof overbookingCaseSummarySchema>;
export type OverbookingScanMetadata = z.infer<typeof overbookingScanMetadataSchema>;
export type OverbookingCaseList = z.infer<typeof overbookingCaseListSchema>;
export type OverbookingCaseDetail = z.infer<typeof overbookingCaseDetailSchema>;
export type OverbookingCasesQuery = z.infer<typeof overbookingCasesQuerySchema>;
export type RelocationPlanRequest = z.infer<typeof relocationPlanRequestSchema>;
export type RelocationPlan = z.infer<typeof relocationPlanSchema>;
export type OverbookingResolveRequest = z.infer<typeof overbookingResolveRequestSchema>;
export type OverbookingResolveResponse = z.infer<typeof overbookingResolveResponseSchema>;
export type RelocationOption = z.infer<typeof relocationOptionSchema>;
export type BookingRelocationOptions = z.infer<typeof bookingRelocationOptionsSchema>;
export type OverbookingAlert = z.infer<typeof overbookingAlertSchema>;
export type OverbookingAlertsView = z.infer<typeof overbookingAlertsViewSchema>;
