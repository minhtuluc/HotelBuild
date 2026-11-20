import { describe, expect, it } from 'vitest';
import { calendarDate, dateTimeVn, LOCALES, LOCALE_META, money } from '../src/index';

describe('HB-275 định dạng dùng chung', () => {
  it('đủ 6 ngôn ngữ, mỗi ngôn ngữ có nhãn viết bằng chính nó', () => {
    expect(LOCALES).toEqual(['vi', 'en', 'zh-CN', 'ja', 'ko', 'ru']);
    expect(LOCALE_META.ja.label).toBe('日本語');
  });

  it('tiền và ngày theo locale, tiếng Việt giữ nguyên định dạng cũ', () => {
    expect(money(1_234_000, 'vi')).toBe('1.234.000 ₫');
    expect(money(1_234_000, 'en')).toBe('1,234,000 ₫');
    expect(calendarDate('2026-12-24', 'vi')).toBe('24/12/2026');
    expect(calendarDate('2026-12-24', 'en')).toBe('24/12/2026');
    expect(dateTimeVn('2026-11-20T05:30:00Z', 'vi', '(giờ VN)')).toBe('20/11/2026 12:30 (giờ VN)');
    expect(dateTimeVn('2026-11-20T05:30:00Z', 'en', '(VN time)')).toBe('20/11/2026 12:30 (VN time)');
  });
});
