/**
 * Hợp đồng REP — báo cáo & xuất báo cáo (api.md §2.12); HB-160.
 * Chỉ số dùng **một** định nghĩa duy nhất (BR-REP-01): ADR/RevPAR trên doanh thu **thuần** (BR-RATE-08),
 * phòng DOR đếm theo **đơn vị bán** (giường). Khoảng ngày là `[from, to)` theo ngày nghiệp vụ.
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema } from './common.js';
import { channelCodeSchema, ratePlanCodeSchema } from './enums.js';

/** Gộp báo cáo theo ngày, loại phòng hay cơ sở (BR-REP-01). */
export const reportGroupBySchema = z.enum(['DAY', 'ROOM_TYPE', 'PROPERTY']);

const reportRange = {
  from: businessDateSchema,
  to: businessDateSchema,
};

export const occupancyReportQuerySchema = z.strictObject({
  propertyId: z.string().min(1).optional(),
  ...reportRange,
  groupBy: reportGroupBySchema.default('DAY'),
});

export const occupancyRowSchema = z.object({
  key: z.string().min(1),
  businessDate: businessDateSchema.optional(),
  propertyId: z.string().min(1).optional(),
  roomTypeId: z.string().min(1).optional(),
  /** Đơn vị bán: phòng, riêng DOR là giường (BR-PROP-03). */
  soldUnits: z.number().int().min(0),
  availableUnits: z.number().int().min(0),
  occupancyPct: z.number().min(0),
});

export const occupancyReportSchema = z.object({
  groupBy: reportGroupBySchema,
  from: businessDateSchema,
  to: businessDateSchema,
  rows: z.array(occupancyRowSchema),
});

export const adrRevparReportQuerySchema = z.strictObject({
  propertyId: z.string().min(1).optional(),
  ...reportRange,
  groupBy: reportGroupBySchema.default('DAY'),
});

export const adrRevparRowSchema = z.object({
  key: z.string().min(1),
  businessDate: businessDateSchema.optional(),
  propertyId: z.string().min(1).optional(),
  roomNightsSold: z.number().int().min(0),
  roomNightsAvailable: z.number().int().min(0),
  /** Doanh thu **thuần** (đã trừ hoa hồng) — BR-RATE-08. */
  netRevenue: z.number().int(),
  adr: z.number().int().min(0),
  revpar: z.number().int().min(0),
});

export const adrRevparReportSchema = z.object({
  groupBy: reportGroupBySchema,
  from: businessDateSchema,
  to: businessDateSchema,
  rows: z.array(adrRevparRowSchema),
});

export const revenueByChannelQuerySchema = z.strictObject({
  ...reportRange,
  channelId: z.string().min(1).optional(),
  propertyId: z.string().min(1).optional(),
});

export const revenueByChannelRowSchema = z.object({
  channelCode: channelCodeSchema,
  grossAmount: z.number().int(),
  commissionAmount: z.number().int().min(0),
  netAmount: z.number().int(),
  bookings: z.number().int().min(0),
});

export const revenueByChannelReportSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  rows: z.array(revenueByChannelRowSchema),
});

export const cancellationsReportQuerySchema = z.strictObject({
  ...reportRange,
  ratePlanCode: ratePlanCodeSchema.optional(),
  propertyId: z.string().min(1).optional(),
});

export const cancellationsRowSchema = z.object({
  ratePlanCode: ratePlanCodeSchema,
  /** Bậc chính sách đã áp; `-1` là bậc bắt tất (BR-CANCEL-01). */
  appliedTierOffsetHours: z.number().int(),
  cancellations: z.number().int().min(0),
  refundAmount: z.number().int().min(0),
});

export const cancellationsReportSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  /** Tỷ lệ huỷ = số booking `CANCELLED` ÷ tổng booking tạo trong kỳ (BR-REP-01). */
  cancellationRate: z.number().min(0),
  rows: z.array(cancellationsRowSchema),
});

export const forceMajeureReportQuerySchema = z.strictObject(reportRange);

export const forceMajeureRowSchema = z.object({
  bookingId: z.string().min(1),
  propertyId: z.string().min(1),
  cancelledAt: isoUtcTimestampSchema,
  refundAmount: z.number().int().min(0),
  note: z.string().min(1).nullable(),
});

export const forceMajeureReportSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  rows: z.array(forceMajeureRowSchema),
});

export const overbookingReportQuerySchema = z.strictObject({
  propertyId: z.string().min(1).optional(),
  ...reportRange,
  status: z.enum(['OPEN', 'PROPOSED', 'RESOLVED', 'ESCALATED']).optional(),
});

export const overbookingRowSchema = z.object({
  caseId: z.string().min(1),
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  businessDate: businessDateSchema,
  status: z.enum(['OPEN', 'PROPOSED', 'RESOLVED', 'ESCALATED']),
  detectedAt: isoUtcTimestampSchema,
  resolvedAt: isoUtcTimestampSchema.nullable(),
  /** Chi phí xử lý = chiết khấu ghép phòng + bồi thường walk-out + hỗ trợ đưa đón (BR-OVER-15). */
  mergeDiscountAmount: z.number().int().min(0),
  walkOutCompensationAmount: z.number().int().min(0),
  transportSupportAmount: z.number().int().min(0),
  totalCost: z.number().int().min(0),
});

export const overbookingReportSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  rows: z.array(overbookingRowSchema),
});

/** Bốn báo cáo xuất được (NFR-COMP-04); tham số là bộ lọc của chính báo cáo đó. */
export const reportNameSchema = z.enum([
  'occupancy',
  'adr-revpar',
  'revenue-by-channel',
  'cancellations',
]);

export const reportExportRequestSchema = z.strictObject({
  report: reportNameSchema,
  format: z.enum(['CSV', 'XLSX']),
  /** Bộ lọc dạng chuỗi của báo cáo; server validate lại theo báo cáo được chọn. */
  params: z.record(z.string(), z.string()),
});

export type OccupancyReport = z.infer<typeof occupancyReportSchema>;
export type AdrRevparReport = z.infer<typeof adrRevparReportSchema>;
export type RevenueByChannelReport = z.infer<typeof revenueByChannelReportSchema>;
export type CancellationsReport = z.infer<typeof cancellationsReportSchema>;
export type ForceMajeureReport = z.infer<typeof forceMajeureReportSchema>;
export type OverbookingReport = z.infer<typeof overbookingReportSchema>;
export type ReportExportRequest = z.infer<typeof reportExportRequestSchema>;
