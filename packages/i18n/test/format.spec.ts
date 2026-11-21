import { describe, expect, it } from 'vitest';
import {
  calendarDate,
  dateLine,
  dateTimeVn,
  dayMonth,
  monthRange,
  weekdayShort,
} from '../src/format';
import { isLocale, localizePath, splitLocale } from '../src/locales';

describe('định dạng ngày lịch theo locale', () => {
  it('vi giữ dd/MM/yyyy và thứ CN/T2…; chuỗi lạ trả nguyên văn', () => {
    expect(calendarDate('2026-12-24', 'vi')).toBe('24/12/2026');
    expect(calendarDate('không-phải-ngày', 'vi')).toBe('không-phải-ngày');
    expect(weekdayShort('2026-12-24', 'vi')).toBe('T5');
    expect(dayMonth('2026-12-24', 'vi')).toBe('24/12');
    expect(dateLine('2026-12-24', 'vi')).toBe('T5, 24/12/2026');
  });

  it('en dùng ngày trước tháng, không lệch ngày theo múi giờ máy', () => {
    expect(calendarDate('2026-12-24', 'en')).toBe('24/12/2026');
    expect(dayMonth('2026-12-24', 'en')).toBe('24/12');
    expect(dateLine('2026-12-24', 'en')).toBe('Thu, 24/12/2026');
  });

  it('ngày không hợp lệ ⇒ null hoặc nguyên văn ở mọi locale', () => {
    expect(calendarDate('2026-02-30', 'ja')).toBe('2026-02-30');
    expect(weekdayShort('2026-02-30', 'en')).toBeNull();
    expect(dayMonth('', 'ru')).toBeNull();
    expect(dateLine('', 'vi')).toBeNull();
    expect(dateLine('2026-13-01', 'ko')).toBeNull();
  });

  it('zh-CN/ja/ko/ru để Intl xếp ngày và chứa đủ năm/tháng/ngày', () => {
    for (const locale of ['zh-CN', 'ja', 'ko', 'ru'] as const) {
      const line = dateLine('2026-12-24', locale) ?? '';
      expect(line).toContain('2026');
      expect(line).toContain('24');
      expect(calendarDate('2026-12-24', locale)).toContain('2026');
    }
  });
});

describe('mốc giờ VN', () => {
  it('en: dd/MM/yyyy HH:mm + nhãn; locale khác có năm và giờ VN', () => {
    expect(dateTimeVn('2026-11-12T07:00:00Z', 'en', '(VN time)')).toBe(
      '12/11/2026 14:00 (VN time)',
    );
    expect(dateTimeVn('2026-11-12T07:00:00Z', 'ru', '(VN)')).toContain('14:00 (VN)');
    expect(dateTimeVn('2026-11-12T07:00:00Z', 'vi', '')).toContain('14:00');
  });

  it('mốc không hợp lệ ⇒ RangeError', () => {
    expect(() => dateTimeVn('xyz', 'en', '')).toThrow(RangeError);
  });
});

describe('nhãn tháng của mùa', () => {
  it('vi và en, một tháng hoặc khoảng; tháng ngoài 1–12 bị bỏ', () => {
    expect(monthRange([11, 12], 'vi')).toBe('Tháng 11 – 12');
    expect(monthRange([5], 'vi')).toBe('Tháng 5');
    expect(monthRange([11, 12], 'en')).toBe('November – December');
    expect(monthRange([0, 13], 'en')).toBe('');
    expect(monthRange([3], 'ru')).toMatch(/^М/);
  });
});

describe('đường dẫn theo locale', () => {
  it('nhận diện locale', () => {
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });

  it('tách tiền tố locale', () => {
    expect(splitLocale('/en/stays/da-lat')).toEqual({ locale: 'en', path: '/stays/da-lat' });
    expect(splitLocale('/zh-cn')).toEqual({ locale: 'zh-CN', path: '/' });
    expect(splitLocale('/stays')).toEqual({ locale: 'vi', path: '/stays' });
  });

  it('thêm tiền tố, giữ query/hash, bỏ qua link ngoài và tệp tĩnh', () => {
    expect(localizePath('/stays?x=1#a', 'en')).toBe('/en/stays?x=1#a');
    expect(localizePath('/', 'ja')).toBe('/ja');
    expect(localizePath('/en/stays', 'vi')).toBe('/stays');
    expect(localizePath('https://example.com', 'en')).toBe('https://example.com');
    expect(localizePath('//cdn', 'en')).toBe('//cdn');
    expect(localizePath('/api/session', 'en')).toBe('/api/session');
    expect(localizePath('/favicon.ico', 'en')).toBe('/favicon.ico');
  });
});
