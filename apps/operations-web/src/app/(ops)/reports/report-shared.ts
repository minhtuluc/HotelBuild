/**
 * Phần thuần dùng chung cho SCR-52…SCR-55 (báo cáo F8): kiểm kỳ, dựng tham số lọc và thân lệnh xuất
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

type OperationStatusKey =
  'reports.op.PENDING' | 'reports.op.RUNNING' | 'reports.op.SUCCEEDED' | 'reports.op.FAILED';

/** Nhãn trạng thái tác vụ để hiển thị (mã enum giữ nguyên, nhãn lấy từ danh mục câu chữ). */
export const OPERATION_STATUS_KEY: Readonly<
  Record<OperationStatusView['status'], OperationStatusKey>
> = {
  PENDING: 'reports.op.PENDING',
  RUNNING: 'reports.op.RUNNING',
  SUCCEEDED: 'reports.op.SUCCEEDED',
  FAILED: 'reports.op.FAILED',
};

/** Nhãn trạng thái ca quá tải (UC-REP-04). */
export const OVERBOOKING_STATUS_KEY: Readonly<
  Record<
    'OPEN' | 'PROPOSED' | 'RESOLVED' | 'ESCALATED',
    | 'reports.over.OPEN'
    | 'reports.over.PROPOSED'
    | 'reports.over.RESOLVED'
    | 'reports.over.ESCALATED'
  >
> = {
  OPEN: 'reports.over.OPEN',
  PROPOSED: 'reports.over.PROPOSED',
  RESOLVED: 'reports.over.RESOLVED',
  ESCALATED: 'reports.over.ESCALATED',
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

/** Tổng hợp dòng báo cáo huỷ: chỉ cộng các con số máy chủ trả theo từng gói/bậc (BR-CANCEL-01). */
export function cancellationsTotals(
  rows: readonly { cancellations: number; refundAmount: number }[],
): { cancellations: number; refundAmount: number } {
  return rows.reduce(
    (acc, row) => ({
      cancellations: acc.cancellations + row.cancellations,
      refundAmount: acc.refundAmount + row.refundAmount,
    }),
    { cancellations: 0, refundAmount: 0 },
  );
}

export interface OverbookingTotals {
  cases: number;
  mergeDiscountAmount: number;
  walkOutCompensationAmount: number;
  transportSupportAmount: number;
  totalCost: number;
}

/** Tổng hợp ca quá tải: số ca và ba khoản chi phí xử lý (BR-OVER-15) đọc nguyên từ máy chủ. */
export function overbookingTotals(
  rows: readonly {
    mergeDiscountAmount: number;
    walkOutCompensationAmount: number;
    transportSupportAmount: number;
    totalCost: number;
  }[],
): OverbookingTotals {
  return rows.reduce<OverbookingTotals>(
    (acc, row) => ({
      cases: acc.cases + 1,
      mergeDiscountAmount: acc.mergeDiscountAmount + row.mergeDiscountAmount,
      walkOutCompensationAmount: acc.walkOutCompensationAmount + row.walkOutCompensationAmount,
      transportSupportAmount: acc.transportSupportAmount + row.transportSupportAmount,
      totalCost: acc.totalCost + row.totalCost,
    }),
    {
      cases: 0,
      mergeDiscountAmount: 0,
      walkOutCompensationAmount: 0,
      transportSupportAmount: 0,
      totalCost: 0,
    },
  );
}
