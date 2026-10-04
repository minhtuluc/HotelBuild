/** HB-043: phần thuần của SCR-16 — tham số lọc, gộp trang con trỏ và xuất CSV (BR-SYS-01,05). */
import { describe, expect, it } from 'vitest';
import type { AuditLogEntry } from '@pinehill/contracts';
import {
  AUDIT_CSV_HEADERS,
  EMPTY_AUDIT_FILTERS,
  auditCsvFileName,
  buildAuditQuery,
  mergeAuditRows,
  toCsv,
} from '../src/lib/audit-log';

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 'a1',
  actorId: 'u1',
  action: 'SystemSettingUpdate',
  entityType: 'SystemSetting',
  entityId: 'pricing.maxDiscountPct',
  reason: null,
  beforeJson: '{"value":"10"}',
  afterJson: '{"value":"15"}',
  createdAt: '2026-11-12T07:00:00.000Z',
  ...over,
});

describe('buildAuditQuery', () => {
  it('bỏ trường rỗng và cắt khoảng trắng thừa', () => {
    const query = buildAuditQuery({ ...EMPTY_AUDIT_FILTERS, actorId: ' u1 ', action: 'Login' });
    expect(query).toEqual({ limit: 50, actorId: 'u1', action: 'Login' });
  });

  it('đổi khoảng thời gian địa phương sang ISO UTC và kèm con trỏ', () => {
    const query = buildAuditQuery(
      { ...EMPTY_AUDIT_FILTERS, from: '2026-11-12T00:00', to: '2026-11-13T00:00' },
      50,
      'c2',
    );
    expect(query.cursor).toBe('c2');
    expect(query.from).toBe(new Date('2026-11-12T00:00').toISOString());
    expect(query.to).toBe(new Date('2026-11-13T00:00').toISOString());
  });
});

describe('mergeAuditRows', () => {
  it('nối trang mới, bỏ bản ghi trùng id và giữ thứ tự máy chủ trả', () => {
    const merged = mergeAuditRows(
      [entry({ id: 'a1' }), entry({ id: 'a2' })],
      [entry({ id: 'a2' }), entry({ id: 'a3' })],
    );
    expect(merged.map((row) => row.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('không mất dòng khi trang sau rỗng', () => {
    const current = [entry({ id: 'a1' })];
    expect(mergeAuditRows(current, [])).toEqual(current);
  });
});

describe('toCsv', () => {
  it('có BOM, tiêu đề cột và kết dòng CRLF', () => {
    const csv = toCsv([entry()]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(AUDIT_CSV_HEADERS.join(','));
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('12/11/2026 14:00 (giờ VN)');
  });

  it('escape theo RFC 4180 và KHÔNG chứa beforeJson/afterJson', () => {
    const csv = toCsv([entry({ reason: 'Đổi, có "nháy"' })]);
    expect(csv).toContain('"Đổi, có ""nháy"""');
    expect(csv).not.toContain('beforeJson');
    expect(csv).not.toContain('{"value"');
  });

  it('ô rỗng cho lý do không có', () => {
    const line = toCsv([entry()]).split('\r\n')[1];
    expect(line?.endsWith(',')).toBe(true);
  });
});

describe('auditCsvFileName', () => {
  it('đặt tên theo mốc thời gian, không dấu hai chấm', () => {
    expect(auditCsvFileName(new Date('2026-11-12T07:00:00.000Z'))).toBe(
      'audit-logs-20261112070000.csv',
    );
  });
});
