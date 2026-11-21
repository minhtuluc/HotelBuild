import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../../src/i18n/catalogs';
import { calendarDate, dateLine, dateTimeVn, money } from '../../src/i18n/format';
import { LOCALES, LOCALE_META, localizePath, splitLocale } from '../../src/i18n/locales';
import { landingContent } from '@pinehill/content/landing-content';
import { CONTENT_PACKS, type PackLocale } from '@pinehill/content/locale-packs';
import { ALL_PHOTO_SLOTS } from '@pinehill/content/photo-slots';
import { PROPERTY_PAGES, propertyPageCopy } from '@pinehill/content/property-pages';
import { ROOM_TYPE_PAGES, roomTypePageCopy } from '@pinehill/content/room-type-pages';

/** HB-313 — bốn locale zh-CN, ja, ko, ru: đường dẫn, định dạng, danh mục và gói nội dung đủ và khớp `vi`. */

const PACK_LOCALES: readonly PackLocale[] = ['zh-CN', 'ja', 'ko', 'ru'];

describe('đường dẫn theo locale', () => {
  it('mỗi locale có tiền tố riêng, tách và ghép đối xứng', () => {
    const prefixes = LOCALES.map((locale) => LOCALE_META[locale].prefix);
    expect(new Set(prefixes).size).toBe(LOCALES.length);
    for (const locale of PACK_LOCALES) {
      const { prefix } = LOCALE_META[locale];
      expect(splitLocale(prefix)).toEqual({ locale, path: '/' });
      expect(splitLocale(`${prefix}/stays/da-lat`)).toEqual({ locale, path: '/stays/da-lat' });
      expect(localizePath('/search?checkIn=2026-12-24#x', locale)).toBe(
        `${prefix}/search?checkIn=2026-12-24#x`,
      );
      expect(localizePath(`${prefix}/bookings`, 'vi')).toBe('/bookings');
    }
  });

  it('đường dẫn trông giống tiền tố nhưng không phải thì giữ ở vi', () => {
    expect(splitLocale('/japan')).toEqual({ locale: 'vi', path: '/japan' });
    expect(splitLocale('/ruby/x')).toEqual({ locale: 'vi', path: '/ruby/x' });
  });
});

describe('định dạng theo ngôn ngữ', () => {
  it('ngày lịch theo thói quen của từng ngôn ngữ, không lệch ngày', () => {
    expect(calendarDate('2026-12-24', 'zh-CN')).toBe('2026/12/24');
    expect(calendarDate('2026-12-24', 'ja')).toBe('2026/12/24');
    expect(calendarDate('2026-12-24', 'ko')).toBe('2026. 12. 24.');
    expect(calendarDate('2026-12-24', 'ru')).toBe('24.12.2026');
    expect(dateLine('2026-12-24', 'ja')).toBe('2026/12/24(木)');
    expect(dateLine('2026-12-24', 'ru')).toBe('чт, 24.12.2026');
  });

  it('giờ VN: ngày theo ngôn ngữ, giờ 24h, nhãn từ danh mục', () => {
    const at = '2026-11-12T07:00:00.000Z';
    expect(dateTimeVn(at, 'ja', '（ベトナム時間）')).toBe('2026/11/12 14:00 （ベトナム時間）');
    expect(dateTimeVn(at, 'ru', '(время Вьетнама)')).toBe('12.11.2026 14:00 (время Вьетнама)');
  });

  it('tiền VND giữ đơn vị ₫, phân cách theo ngôn ngữ', () => {
    expect(money(1_222_000, 'zh-CN')).toBe('1,222,000 ₫');
    expect(money(1_222_000, 'ru').replace(/\s/g, ' ')).toBe('1 222 000 ₫');
  });
});

describe('danh mục', () => {
  const vars = (text: string): string =>
    [...text.matchAll(/\{(\w+)\}/g)]
      .map((match) => match[1])
      .sort()
      .join(',');

  it('placeholder {…} của mọi locale khớp vi ở mọi khoá', () => {
    for (const locale of PACK_LOCALES) {
      for (const part of ['customer', 'account', 'payment'] as const) {
        const reference = Object.entries(CATALOGS.vi[part]);
        const catalog = new Map(Object.entries(CATALOGS[locale][part]));
        for (const [key, text] of reference) {
          expect(vars(catalog.get(key) ?? ''), `${locale}.${part}.${key}`).toBe(vars(text));
        }
      }
    }
  });
});

describe('gói nội dung', () => {
  const slotIds = ALL_PHOTO_SLOTS.map((slot) => slot.id).sort();

  it('alt ảnh có đúng mọi ô ảnh, không thừa không thiếu, không rỗng', () => {
    for (const locale of PACK_LOCALES) {
      const alts = CONTENT_PACKS[locale].photoAlts;
      expect(Object.keys(alts).sort(), locale).toEqual(slotIds);
      for (const [id, alt] of Object.entries(alts))
        expect(alt.trim(), `${locale}.${id}`).not.toBe('');
    }
  });

  it('dữ kiện chính sách và ví dụ giá trùng bản vi (chỉ khác câu chữ)', () => {
    const vi = landingContent('vi');
    const facts = (locale: (typeof LOCALES)[number]): unknown => {
      const content = landingContent(locale);
      return {
        stations: content.stations.map((station) => station.code),
        classes: content.cabinClasses.map((cabin) => cabin.code),
        factors: content.fareFactors.length,
        nights: content.sampleTicket.nights.map((night) => night.amount),
        total: content.sampleTicket.total,
        plans: content.farePlans.map((plan) => ({
          code: plan.code,
          steps: plan.steps.map(({ fromHours, refundPercent, firstNightCharge }) => ({
            fromHours,
            refundPercent,
            firstNightCharge,
          })),
        })),
        steps: content.bookingSteps.length,
        faq: content.faq.length,
      };
    };
    for (const locale of PACK_LOCALES) expect(facts(locale), locale).toEqual(facts('vi'));
    expect(vi.stations.length).toBe(3);
  });

  it('mọi trang ga và trang hạng phòng có câu chữ ở mọi locale', () => {
    for (const locale of LOCALES) {
      for (const page of PROPERTY_PAGES) {
        expect(propertyPageCopy(page.slug, locale)?.story.length, locale).toBeGreaterThan(0);
      }
      for (const page of ROOM_TYPE_PAGES) {
        expect(roomTypePageCopy(page.code, locale)?.description.length, locale).toBeGreaterThan(0);
      }
    }
  });
});
