import { describe, expect, it } from 'vitest';
import { formatMoney } from '@pinehill/ui-web';
import { calendarDate, dateLine, dayMonth, money, weekdayShort } from '../../src/i18n/format';
import { calendarDay } from '../../src/components/stamps';

/** HB-309 — định dạng theo locale; với `vi` đầu ra giữ nguyên như trước khi tách locale. */

describe('định dạng vi giữ đầu ra cũ', () => {
  it('ngày lịch dd/MM/yyyy, chuỗi lạ trả nguyên văn', () => {
    expect(calendarDate('2026-12-24', 'vi')).toBe('24/12/2026');
    expect(calendarDate('2026-01-05', 'vi')).toBe('05/01/2026');
    expect(calendarDate('không-phải-ngày', 'vi')).toBe('không-phải-ngày');
    expect(calendarDate('', 'vi')).toBe('');
  });

  it('thứ ngắn CN/T2…T7 theo ngày lịch, không theo múi giờ máy', () => {
    expect(weekdayShort('2026-12-24', 'vi')).toBe('T5');
    expect(weekdayShort('2026-12-27', 'vi')).toBe('CN');
    expect(weekdayShort('2026-12-28', 'vi')).toBe('T2');
    expect(weekdayShort('2026-02-30', 'vi')).toBeNull();
    expect(weekdayShort('', 'vi')).toBeNull();
  });

  it('tem đêm in thứ + ngày/tháng như trước', () => {
    expect(dayMonth('2026-12-24', 'vi')).toBe('24/12');
    expect(calendarDay('2026-12-24', 'vi')).toEqual({
      iso: '2026-12-24',
      weekday: 'T5',
      dayMonth: '24/12',
    });
    expect(calendarDay('24/12/2026', 'vi')).toBeNull();
  });

  it('dòng ngày dưới ô ngày: "T5, 24/12/2026"; chưa chọn ngày thì null', () => {
    expect(dateLine('2026-12-24', 'vi')).toBe('T5, 24/12/2026');
    expect(dateLine('2027-01-03', 'vi')).toBe('CN, 03/01/2027');
    expect(dateLine('', 'vi')).toBeNull();
  });

  it('tiền VND số nguyên, dấu chấm phân cách nghìn; mặc định ui-web không đổi', () => {
    expect(money(1_222_000, 'vi')).toBe('1.222.000 ₫');
    expect(formatMoney(1_222_000)).toBe('1.222.000 ₫');
    expect(formatMoney(1_222_000, 'en-US')).toBe('1,222,000 ₫');
    expect(() => money(1.5, 'vi')).toThrow(RangeError);
  });
});
