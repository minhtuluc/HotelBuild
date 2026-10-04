/**
 * SCR-16 — phần thuần cho nhật ký kiểm toán (UC-SYS-01, BR-SYS-01,05): dựng tham số lọc, gộp trang
 * theo con trỏ và xuất CSV đúng các cột đang hiển thị. Không đọc/ghi I/O; kiểm được bằng vitest.
 * `beforeJson`/`afterJson` **không** đi vào CSV hay bảng — chỉ trường an toàn (NFR-SEC-04).
 */
import type { AuditLogEntry } from '@pinehill/contracts';
import { formatDateTimeVn } from '@pinehill/ui-web';

/** Số bản ghi mỗi trang (khớp mặc định `auditLogQuerySchema`, tối đa 100). */
export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  /** Giờ địa phương dạng `YYYY-MM-DDTHH:mm` (input `datetime-local`), chuyển sang ISO UTC khi gửi. */
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  actorId: '',
  entityType: '',
  entityId: '',
  action: '',
  from: '',
  to: '',
};

export interface AuditPageQuery {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

/** Giá trị rỗng bị bỏ hẳn khỏi truy vấn; `datetime-local` đổi sang ISO UTC để khớp hợp đồng. */
export function buildAuditQuery(
  filters: AuditFilters,
  limit: number = AUDIT_PAGE_SIZE,
  cursor?: string,
): AuditPageQuery {
  const query: AuditPageQuery = { limit };
  if (filters.actorId.trim() !== '') query.actorId = filters.actorId.trim();
  if (filters.entityType.trim() !== '') query.entityType = filters.entityType.trim();
  if (filters.entityId.trim() !== '') query.entityId = filters.entityId.trim();
  if (filters.action.trim() !== '') query.action = filters.action.trim();
  if (filters.from !== '') query.from = new Date(filters.from).toISOString();
  if (filters.to !== '') query.to = new Date(filters.to).toISOString();
  if (cursor !== undefined && cursor !== '') query.cursor = cursor;
  return query;
}

/** Nối trang mới vào danh sách đang xem, bỏ bản ghi trùng id (giữ thứ tự máy chủ trả). */
export function mergeAuditRows(
  current: readonly AuditLogEntry[],
  incoming: readonly AuditLogEntry[],
): readonly AuditLogEntry[] {
  const seen = new Set(current.map((row) => row.id));
  const merged = [...current];
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

/** Cột hiển thị = cột CSV; danh sách trường an toàn theo BR-SYS-05 (không có JSON thô, token, PII). */
export const AUDIT_CSV_HEADERS = [
  'Thời điểm',
  'Người thao tác',
  'Hành động',
  'Loại đối tượng',
  'Mã đối tượng',
  'Lý do',
] as const;

function csvCell(value: string): string {
  // RFC 4180: bọc nháy kép khi chứa dấu phẩy/nháy/xuống dòng và nhân đôi nháy kép bên trong.
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Một dòng CSV cho bản ghi, đúng 6 cột đang hiển thị. */
export function csvRow(entry: AuditLogEntry): string {
  return [
    formatDateTimeVn(entry.createdAt),
    entry.actorId,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.reason ?? '',
  ]
    .map(csvCell)
    .join(',');
}

/** Xuất CSV các dòng đang hiển thị: BOM UTF-8, `\r\n`, có tiêu đề cột (RFC 4180). */
export function toCsv(rows: readonly AuditLogEntry[]): string {
  const lines = [AUDIT_CSV_HEADERS.map(csvCell).join(','), ...rows.map(csvRow)];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function auditCsvFileName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replaceAll(/[:T-]/g, '');
  return `audit-logs-${stamp}.csv`;
}
