/**
 * Phần thuần dùng chung cho SCR-52/SCR-53 (báo cáo F8): kiểm kỳ, dựng tham số lọc và thân lệnh xuất
 * báo cáo, theo dõi tác vụ bất đồng bộ. Không tính chỉ số — mọi con số do máy chủ trả (BR-REP-01).
 */
import type { OperationStatusView, ReportExportRequest } from '@pinehill/contracts';

export interface FieldIssue {
  field: string;
  issue: string;
}

export interface ReportFilters {
  propertyId: string;
  from: string;
  to: string;
  groupBy: 'DAY' | 'ROOM_TYPE' | 'PROPERTY';
}

/** Kỳ báo cáo phải có ít nhất một ngày và kết thúc sau ngày bắt đầu (`[from, to)` sau quy đổi). */
export function rangeIssue(from: string, to: string): FieldIssue | null {
  if (from.trim() === '') return { field: 'from', issue: 'REQUIRED' };
  if (to.trim() === '') return { field: 'to', issue: 'REQUIRED' };
  return Date.parse(`${to}T00:00:00Z`) <= Date.parse(`${from}T00:00:00Z`)
    ? { field: 'to', issue: 'BEFORE_START' }
    : null;
}

/** Tham số lọc dạng chuỗi cho thân lệnh xuất (`reportExportRequestSchema.params`). */
export function filtersToParams(filters: ReportFilters): Record<string, string> {
  const params: Record<string, string> = { from: filters.from, to: filters.to };
  if (filters.propertyId !== '') params.propertyId = filters.propertyId;
  return params;
}

/** Thân lệnh `POST /reports/export` (202 + `operationId`), theo hợp đồng HB-160. */
export function exportRequest(
  report: ReportExportRequest['report'],
  format: ReportExportRequest['format'],
  params: Record<string, string>,
): ReportExportRequest {
  return { report, format, params };
}

/** Tác vụ đã kết thúc (không cần hỏi lại) — `SUCCEEDED`/`FAILED`. */
export function isTerminal(status: OperationStatusView['status']): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED';
}

/** Nhãn trạng thái tác vụ để hiển thị (mã enum giữ nguyên, nhãn lấy từ danh mục câu chữ). */
export const OPERATION_STATUS_KEY: Readonly<
  Record<
    OperationStatusView['status'],
    'reports.op.PENDING' | 'reports.op.RUNNING' | 'reports.op.SUCCEEDED' | 'reports.op.FAILED'
  >
> = {
  PENDING: 'reports.op.PENDING',
  RUNNING: 'reports.op.RUNNING',
  SUCCEEDED: 'reports.op.SUCCEEDED',
  FAILED: 'reports.op.FAILED',
};

/** Tổng hợp dòng báo cáo doanh thu theo kênh: cộng đúng các con số máy chủ trả, không suy diễn. */
export function revenueTotals(
  rows: readonly {
    grossAmount: number;
    commissionAmount: number;
    netAmount: number;
    bookings: number;
  }[],
): { grossAmount: number; commissionAmount: number; netAmount: number; bookings: number } {
  return rows.reduce(
    (acc, row) => ({
      grossAmount: acc.grossAmount + row.grossAmount,
      commissionAmount: acc.commissionAmount + row.commissionAmount,
      netAmount: acc.netAmount + row.netAmount,
      bookings: acc.bookings + row.bookings,
    }),
    { grossAmount: 0, commissionAmount: 0, netAmount: 0, bookings: 0 },
  );
}
