import {
  adrRevparReportQuerySchema,
  cancellationsReportQuerySchema,
  forceMajeureReportQuerySchema,
  occupancyReportQuerySchema,
  overbookingReportQuerySchema,
  revenueByChannelQuerySchema,
} from '@pinehill/contracts';
import { invalid, uuid, validDate } from '../../inv/allotments/validation.js';

/**
 * Kỳ báo cáo tối đa. Hợp đồng REP (`packages/contracts/src/report.ts`) **không** khai trần, nên module
 * tự chặn ở một năm để câu truy vấn tổng hợp có biên tài nguyên; chuẩn hiệu năng NFR-PERF-04/TC-REP-04
 * chỉ đo tới 90 ngày. Vượt trần trả `400 E_GEN_VALIDATION_FAILED`.
 */
export const MAX_REPORT_DAYS = 366;

/** Khoảng ngày nghiệp vụ `[from, to)` (report.ts §đầu tệp): ít nhất một ngày, có biên trên. */
function reportRange(from: string, to: string): void {
  if (!validDate(from) || !validDate(to)) throw invalid();
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!(start < end) || end - start > MAX_REPORT_DAYS * 86400000) throw invalid();
}

export type ReportGroupBy = 'DAY' | 'ROOM_TYPE' | 'PROPERTY';
export type OverbookingStatus = 'OPEN' | 'PROPOSED' | 'RESOLVED' | 'ESCALATED';

export interface GroupedReportInput {
  readonly from: string;
  readonly to: string;
  readonly groupBy: ReportGroupBy;
  readonly propertyId?: string;
}

function grouped(value: unknown, schema: typeof occupancyReportQuerySchema): GroupedReportInput {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid();
  reportRange(result.data.from, result.data.to);
  return {
    from: result.data.from,
    to: result.data.to,
    groupBy: result.data.groupBy,
    ...(result.data.propertyId === undefined ? {} : { propertyId: uuid(result.data.propertyId) }),
  };
}

export const occupancyInput = (value: unknown): GroupedReportInput =>
  grouped(value, occupancyReportQuerySchema);

export const adrRevparInput = (value: unknown): GroupedReportInput =>
  grouped(value, adrRevparReportQuerySchema);

export interface RevenueByChannelInput {
  readonly from: string;
  readonly to: string;
  readonly channelId?: string;
  readonly propertyId?: string;
}

export function revenueByChannelInput(value: unknown): RevenueByChannelInput {
  const result = revenueByChannelQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  reportRange(result.data.from, result.data.to);
  return {
    from: result.data.from,
    to: result.data.to,
    ...(result.data.channelId === undefined ? {} : { channelId: uuid(result.data.channelId) }),
    ...(result.data.propertyId === undefined ? {} : { propertyId: uuid(result.data.propertyId) }),
  };
}

export interface CancellationsInput {
  readonly from: string;
  readonly to: string;
  readonly ratePlanCode?: string;
  readonly propertyId?: string;
}

export function cancellationsInput(value: unknown): CancellationsInput {
  const result = cancellationsReportQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  reportRange(result.data.from, result.data.to);
  return {
    from: result.data.from,
    to: result.data.to,
    ...(result.data.ratePlanCode === undefined ? {} : { ratePlanCode: result.data.ratePlanCode }),
    ...(result.data.propertyId === undefined ? {} : { propertyId: uuid(result.data.propertyId) }),
  };
}

export interface RangeInput {
  readonly from: string;
  readonly to: string;
}

export function forceMajeureInput(value: unknown): RangeInput {
  const result = forceMajeureReportQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  reportRange(result.data.from, result.data.to);
  return { from: result.data.from, to: result.data.to };
}

export interface OverbookingInput extends RangeInput {
  readonly propertyId?: string;
  readonly status?: OverbookingStatus;
}

export function overbookingInput(value: unknown): OverbookingInput {
  const result = overbookingReportQuerySchema.safeParse(value);
  if (!result.success) throw invalid();
  reportRange(result.data.from, result.data.to);
  return {
    from: result.data.from,
    to: result.data.to,
    ...(result.data.propertyId === undefined ? {} : { propertyId: uuid(result.data.propertyId) }),
    ...(result.data.status === undefined ? {} : { status: result.data.status }),
  };
}
