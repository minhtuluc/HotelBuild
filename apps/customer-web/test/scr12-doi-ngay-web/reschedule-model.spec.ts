import { describe, expect, it } from 'vitest';
import {
  STAY_ISSUE_KEYS,
  isSameStay,
  nightsBetween,
  stayDifference,
  stayIssue,
} from '../../src/app/(guest)/bookings/reschedule-model';

describe('SCR-12 đổi ngày (HB-104)', () => {
  it('đếm số đêm giữa hai mốc ngày, từ chối mốc không hợp lệ', () => {
    expect(nightsBetween('2026-12-24', '2026-12-26')).toBe(2);
    expect(nightsBetween('2026-12-24', '2026-12-25')).toBe(1);
    expect(nightsBetween('2026-12-24', '2026-12-24')).toBeNull();
    expect(nightsBetween('2026-12-26', '2026-12-24')).toBeNull();
    expect(nightsBetween('2026-12-24', '2028-12-24')).toBeNull();
    expect(nightsBetween('không-phải-ngày', '2026-12-26')).toBeNull();
  });

  it('báo lỗi kỳ mới tại chỗ để không gọi API vô ích', () => {
    expect(stayIssue('', '2026-12-26')).toBe('MISSING');
    expect(stayIssue('2026-12-24', '')).toBe('MISSING');
    expect(stayIssue('2026-12-24', '2026-12-24')).toBe('ORDER');
    expect(stayIssue('2026-12-26', '2026-12-24')).toBe('ORDER');
    expect(stayIssue('2026-12-24', '2028-12-24')).toBe('RANGE');
    expect(stayIssue('2026-12-24', '2026-12-26')).toBeNull();
    expect(Object.keys(STAY_ISSUE_KEYS).sort()).toEqual(['MISSING', 'ORDER', 'RANGE']);
  });

  it('nhận ra kỳ mới trùng kỳ đang giữ', () => {
    const current = { checkIn: '2026-12-24', checkOut: '2026-12-26' };
    expect(isSameStay(current, { checkIn: '2026-12-24', checkOut: '2026-12-26' })).toBe(true);
    expect(isSameStay(current, { checkIn: '2026-12-25', checkOut: '2026-12-26' })).toBe(false);
    expect(isSameStay(current, { checkIn: '2026-12-24', checkOut: '2026-12-27' })).toBe(false);
  });

  it('chênh lệch chỉ là hiệu hai con số máy chủ trả, luôn trả số dương kèm chiều', () => {
    expect(stayDifference(3_000_000, 1_000_000)).toEqual({ kind: 'more', amount: 2_000_000 });
    expect(stayDifference(1_000_000, 3_000_000)).toEqual({ kind: 'less', amount: 2_000_000 });
    expect(stayDifference(2_000_000, 2_000_000)).toEqual({ kind: 'same', amount: 0 });
  });
});
