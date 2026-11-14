import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../../src/i18n/catalogs';
import { EN_NEEDS_REVIEW } from '../../src/i18n/catalogs/en/review';
import { calendarDate, dateLine, dateTimeVn, money, weekdayShort } from '../../src/i18n/format';
import { localizePath, splitLocale } from '../../src/i18n/locales';
import { localeAlternates } from '../../src/i18n/seo';

/** HB-312 — tiếng Anh: đường dẫn theo locale, hreflang, định dạng `en`, danh sách khoá cần duyệt. */

describe('đường dẫn theo locale', () => {
  it('tách và thêm tiền tố /en, giữ query và hash', () => {
    expect(splitLocale('/en')).toEqual({ locale: 'en', path: '/' });
    expect(splitLocale('/en/stays/da-lat')).toEqual({ locale: 'en', path: '/stays/da-lat' });
    expect(splitLocale('/english')).toEqual({ locale: 'vi', path: '/english' });
    expect(localizePath('/', 'en')).toBe('/en');
    expect(localizePath('/search?checkIn=2026-12-24#x', 'en')).toBe(
      '/en/search?checkIn=2026-12-24#x',
    );
    expect(localizePath('/?ga=da-lat#search-block', 'en')).toBe('/en?ga=da-lat#search-block');
    expect(localizePath('/en/bookings', 'vi')).toBe('/bookings');
    expect(localizePath('/en/bookings', 'en')).toBe('/en/bookings');
  });

  it('không đụng link ngoài, neo cùng trang, API và tệp tĩnh', () => {
    expect(localizePath('https://example.com/x', 'en')).toBe('https://example.com/x');
    expect(localizePath('#search-block', 'en')).toBe('#search-block');
    expect(localizePath('/api/session/journey/public/properties', 'en')).toBe(
      '/api/session/journey/public/properties',
    );
    expect(localizePath('/images/pine-hill/ga-DL-poster.webp', 'en')).toBe(
      '/images/pine-hill/ga-DL-poster.webp',
    );
  });

  it('hreflang đủ vi, en, x-default; canonical theo locale', () => {
    expect(localeAlternates('/stays/da-lat', 'en')).toEqual({
      canonical: '/en/stays/da-lat',
      languages: { vi: '/stays/da-lat', en: '/en/stays/da-lat', 'x-default': '/stays/da-lat' },
    });
  });
});

describe('định dạng en', () => {
  it('ngày trước tháng (en-GB), thứ tiếng Anh, tiền phân cách bằng dấu phẩy', () => {
    expect(calendarDate('2026-12-24', 'en')).toBe('24/12/2026');
    expect(weekdayShort('2026-12-24', 'en')).toBe('Thu');
    expect(dateLine('2026-12-24', 'en')).toBe('Thu, 24/12/2026');
    expect(money(1_222_000, 'en')).toBe('1,222,000 ₫');
  });

  it('giờ VN: vi giữ đầu ra cũ, en cùng thứ tự với nhãn tiếng Anh', () => {
    expect(dateTimeVn('2026-11-12T07:00:00.000Z', 'vi', '(giờ VN)')).toBe(
      '12/11/2026 14:00 (giờ VN)',
    );
    expect(dateTimeVn('2026-11-12T07:00:00.000Z', 'en', '(Vietnam time)')).toBe(
      '12/11/2026 14:00 (Vietnam time)',
    );
  });
});

describe('khoá cần duyệt trước phát hành', () => {
  it('mọi khoá trong EN_NEEDS_REVIEW có thật trong danh mục en', () => {
    for (const part of ['customer', 'account', 'payment'] as const) {
      const catalog = CATALOGS.en[part];
      for (const key of EN_NEEDS_REVIEW[part]) expect(Object.hasOwn(catalog, key), key).toBe(true);
    }
  });

  it('placeholder {…} của en khớp vi ở mọi khoá', () => {
    const vars = (text: string): string =>
      [...text.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(',');
    for (const part of ['customer', 'account', 'payment'] as const) {
      const vi = CATALOGS.vi[part];
      const en = CATALOGS.en[part];
      for (const [key, text] of Object.entries(vi)) {
        expect(
          vars(Object.entries(en).find(([name]) => name === key)?.[1] ?? ''),
          `${part}.${key}`,
        ).toBe(vars(text));
      }
    }
  });
});
