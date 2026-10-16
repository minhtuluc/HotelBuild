import {
  adrRevparReportQuerySchema,
  cancellationsReportQuerySchema,
  occupancyReportQuerySchema,
  reportExportRequestSchema,
  revenueByChannelQuerySchema,
  type ReportExportRequest,
} from '@pinehill/contracts';
import { invalid } from '../../inv/allotments/validation.js';

const parsers = {
  occupancy: occupancyReportQuerySchema,
  'adr-revpar': adrRevparReportQuerySchema,
  'revenue-by-channel': revenueByChannelQuerySchema,
  cancellations: cancellationsReportQuerySchema,
} as const;

export interface ExportInput {
  readonly report: ReportExportRequest['report'];
  readonly format: ReportExportRequest['format'];
  readonly params: Readonly<Record<string, string>>;
}

/**
 * `params` là chuỗi tự do ở hợp đồng nên máy chủ **kiểm lại theo báo cáo được chọn** trước khi chạy truy
 * vấn (api.md §2.12: “server validate lại theo báo cáo được chọn”).
 */
export function exportInput(value: unknown): ExportInput {
  const result = reportExportRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  const params = parsers[result.data.report].safeParse(result.data.params);
  if (!params.success) throw invalid();
  return result.data;
}
