/**
 * SCR-17 — tham số hệ thống (UC-SYS-02, BR-SYS-02,05): phần thuần kiểm được bằng vitest.
 * Kiểu giá trị do máy chủ khai (`valueType`) và giao diện kiểm **tại chỗ** trước khi gửi; mọi thao tác
 * ghi phải kèm lý do và `If-Match` theo phiên bản (ADR-017).
 */
import type { SystemSetting, SystemSettingValueType } from '@pinehill/contracts';

export interface FieldIssue {
  field: string;
  issue: string;
}

/** Kiểm giá trị theo `valueType` máy chủ khai — đúng bốn kiểu của csdl §3. */
export function valueIssue(valueType: SystemSettingValueType, raw: string): FieldIssue | null {
  const value = raw.trim();
  if (valueType === 'BOOLEAN') {
    return value === 'true' || value === 'false' ? null : { field: 'value', issue: 'NOT_BOOLEAN' };
  }
  if (valueType === 'NUMBER') {
    return value !== '' && Number.isFinite(Number(value))
      ? null
      : { field: 'value', issue: 'NOT_NUMBER' };
  }
  if (valueType === 'JSON') {
    try {
      JSON.parse(value);
      return null;
    } catch {
      return { field: 'value', issue: 'NOT_JSON' };
    }
  }
  return value === '' ? { field: 'value', issue: 'REQUIRED' } : null;
}

/** Lý do bắt buộc và giá trị phải khác giá trị hiện tại (không gửi lệnh vô nghĩa). */
export function validateEdit(
  setting: SystemSetting,
  value: string,
  reason: string,
): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  const issue = valueIssue(setting.valueType, value);
  if (issue !== null) issues.push(issue);
  if (issue === null && value.trim() === setting.value) {
    issues.push({ field: 'value', issue: 'UNCHANGED' });
  }
  if (reason.trim() === '') issues.push({ field: 'reason', issue: 'REQUIRED' });
  return issues;
}

/** `reason` là lý do tự do tối đa 500 ký tự; `value` giữ nguyên chuỗi đã nhập (hợp đồng nhận chuỗi). */
export function updateRequest(value: string, reason: string): { value: string; reason: string } {
  return { value: value.trim(), reason: reason.trim() };
}

/** ETag theo phiên bản (`"7"`) — thiếu thì máy chủ trả 428 (api.md §1.3). */
export function ifMatchOf(version: number): string {
  return `"${version}"`;
}

/** Liên kết sang SCR-16 kèm lọc sẵn theo đối tượng `SystemSetting` (HB-044 AC6). */
export function auditLogHref(key: string): string {
  const query = new URLSearchParams({ entityType: 'SystemSetting', entityId: key });
  return `/audit-logs?${query.toString()}`;
}
