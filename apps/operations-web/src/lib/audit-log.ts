/**
 * SCR-16 — phần thuần cho nhật ký kiểm toán (UC-SYS-01, BR-SYS-01,05): dựng tham số lọc, gộp trang
 * theo con trỏ và xuất CSV đúng các cột đang hiển thị. Không đọc/ghi I/O; kiểm được bằng vitest.
 * `beforeJson`/`afterJson` **không** đi vào CSV hay bảng — chỉ trường an toàn (NFR-SEC-04).
 */
import type { AuditLogEntry } from '@pinehill/contracts';
import { formatDateTimeVn } from '@pinehill/ui-web';
import { t } from './i18n';

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
  if (filters.from !== '') query.from = vnInputUtc(filters.from);
  if (filters.to !== '') query.to = vnInputUtc(filters.to);
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
  t('audit.col.time'),
  t('audit.col.actor'),
  t('audit.col.action'),
  t('audit.col.entityType'),
  t('audit.col.entityId'),
  t('audit.col.reason'),
] as const;

function csvCell(value: string): string {
  if (/^[\s\uFEFF]*[=+@-]/.test(value)) value = "'" + value;
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

/** Explicit VN wall time; validation rejects Date rollover rather than silently changing the filter. */
function vnInputUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('Invalid VN datetime');
  const civil = new Date(value + 'Z');
  if (!Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 16) !== value)
    throw Error('Invalid VN datetime');
  return new Date(value + '+07:00').toISOString();
}
