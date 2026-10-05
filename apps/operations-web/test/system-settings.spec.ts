/** HB-044: phần thuần SCR-17 — kiểm giá trị theo kiểu, lý do bắt buộc, ETag và liên kết lịch sử. */
import { describe, expect, it } from 'vitest';
import type { SystemSetting } from '@pinehill/contracts';
import {
  auditLogHref,
  ifMatchOf,
  updateRequest,
  validateEdit,
  valueIssue,
} from '../src/lib/system-settings';

const setting = (over: Partial<SystemSetting> = {}): SystemSetting => ({
  key: 'pricing.maxDiscountPct',
  value: '20',
  valueType: 'NUMBER',
  description: 'Trần giảm giá tối đa',
  updatedBy: 'u1',
  updatedAt: '2026-11-12T07:00:00.000Z',
  version: 4,
  ...over,
});

describe('valueIssue', () => {
  it('NUMBER nhận số (kể cả âm và thập phân)', () => {
    expect(valueIssue('NUMBER', '20')).toBeNull();
    expect(valueIssue('NUMBER', '-3')).toBeNull();
    expect(valueIssue('NUMBER', '0.85')).toBeNull();
    expect(valueIssue('NUMBER', 'hai mươi')).toEqual({ field: 'value', issue: 'NOT_NUMBER' });
  });

  it('JSON phải parse được', () => {
    expect(valueIssue('JSON', '{"a":1}')).toBeNull();
    expect(valueIssue('JSON', '{a:1}')).toEqual({ field: 'value', issue: 'NOT_JSON' });
  });

  it('BOOLEAN chỉ nhận true/false', () => {
    expect(valueIssue('BOOLEAN', 'true')).toBeNull();
    expect(valueIssue('BOOLEAN', '1')).toEqual({ field: 'value', issue: 'NOT_BOOLEAN' });
  });

  it('STRING không được rỗng', () => {
    expect(valueIssue('STRING', 'Asia/Ho_Chi_Minh')).toBeNull();
    expect(valueIssue('STRING', '   ')).toEqual({ field: 'value', issue: 'REQUIRED' });
  });
});

describe('validateEdit', () => {
  it('bắt buộc lý do và chặn giá trị không đổi', () => {
    expect(validateEdit(setting(), '25', '')).toEqual([{ field: 'reason', issue: 'REQUIRED' }]);
    expect(validateEdit(setting(), '20', 'Tăng trần')).toEqual([
      { field: 'value', issue: 'UNCHANGED' },
    ]);
    expect(validateEdit(setting(), '25', 'Tăng trần')).toEqual([]);
  });

  it('ưu tiên lỗi kiểu giá trị hơn lỗi không đổi', () => {
    expect(validateEdit(setting(), 'x', 'Lý do')).toEqual([
      { field: 'value', issue: 'NOT_NUMBER' },
    ]);
  });
});

describe('updateRequest / ifMatchOf / auditLogHref', () => {
  it('cắt khoảng trắng của value và reason', () => {
    expect(updateRequest('  25 ', '  Tăng trần  ')).toEqual({ value: '25', reason: 'Tăng trần' });
  });

  it('ETag đóng gói phiên bản', () => {
    expect(ifMatchOf(4)).toBe('"4"');
  });

  it('liên kết lịch sử trỏ SCR-16 kèm lọc theo đối tượng', () => {
    const href = auditLogHref('pricing.maxDiscountPct');
    expect(href.startsWith('/audit-logs?')).toBe(true);
    const query = new URLSearchParams(href.split('?')[1]);
    expect(query.get('entityType')).toBe('SystemSetting');
    expect(query.get('entityId')).toBe('pricing.maxDiscountPct');
  });
});
