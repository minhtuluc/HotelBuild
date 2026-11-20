import { describe, expect, it } from 'vitest';
import {
  nextWeekendIn,
  seasonIndexFor,
  weekendHref,
} from '../../src/components/content/season-almanac';
import { PROPERTY_PAGES, propertyPageCopy } from '@pinehill/content/property-pages';
import { ROOM_TYPE_PAGES, roomTypePageCopy } from '@pinehill/content/room-type-pages';
import { monthRange } from '../../src/i18n/format';
import { LOCALES } from '../../src/i18n/locales';

/** HB-322 — bảng chặng, "Một ngày tại ga", lịch mùa (FEAT-02), bố cục khoang (CONT-01). */

describe('nội dung trang ga sâu hơn', () => {
  it('mọi ga, mọi locale có chặng, ba buổi và bốn mùa có chữ', () => {
    for (const page of PROPERTY_PAGES) {
      for (const locale of LOCALES) {
        const copy = propertyPageCopy(page.slug, locale);
        const where = `${page.slug}/${locale}`;
        expect(copy, where).toBeDefined();
        if (copy === undefined) continue;
        expect(copy.legs.length, where).toBeGreaterThanOrEqual(2);
        expect(copy.seasons, where).toHaveLength(page.seasonMonths.length);
        const texts = [
          ...copy.legs.flatMap((leg) => [leg.time, leg.route]),
          copy.arrivalNote,
          ...copy.day,
          ...copy.seasons.flatMap((season) => [season.name, season.weather, season.tip]),
        ];
        expect(
          texts.filter((text) => text.trim() === ''),
          where,
        ).toEqual([]);
      }
    }
  });

  it('tháng của bốn mùa phủ đủ 12 tháng, không trùng', () => {
    for (const page of PROPERTY_PAGES) {
      expect(page.seasonMonths, page.slug).toHaveLength(4);
      const all = page.seasonMonths.flat();
      expect(
        [...all].sort((a, b) => a - b),
        page.slug,
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
  });

  it('lịch mùa không gắn nhãn mùa giá (Q14), không số tiền', () => {
    for (const page of PROPERTY_PAGES) {
      for (const locale of LOCALES) {
        const text = JSON.stringify(propertyPageCopy(page.slug, locale)?.seasons);
        expect(text, `${page.slug}/${locale}`).not.toMatch(
          /₫|\bVND\b|cao điểm|thấp điểm|peak|off-peak/i,
        );
      }
    }
  });
});

describe('cuối tuần gần nhất trong mùa', () => {
  it('thứ Sáu → Chủ nhật, không trước hôm nay; hôm nay là thứ Sáu thì lấy hôm nay', () => {
    // 2026-11-15 là Chủ nhật; thứ Sáu kế tiếp 2026-11-20.
    expect(nextWeekendIn([11, 12], '2026-11-15')).toEqual({
      checkIn: '2026-11-20',
      checkOut: '2026-11-22',
    });
    expect(nextWeekendIn([11], '2026-11-20')).toEqual({
      checkIn: '2026-11-20',
      checkOut: '2026-11-22',
    });
  });

  it('mùa chưa tới thì lấy thứ Sáu đầu tiên của mùa, qua năm mới đúng', () => {
    expect(nextWeekendIn([1, 2, 3], '2026-11-15')).toEqual({
      checkIn: '2027-01-01',
      checkOut: '2027-01-03',
    });
    // Thứ Sáu cuối của tháng 11 đã qua → sang tháng 11 năm sau.
    expect(nextWeekendIn([11], '2026-11-28')?.checkIn).toBe('2027-11-05');
    expect(nextWeekendIn([], '2026-11-15')).toBeNull();
  });

  it('mùa hiện tại theo tháng; link về khối tìm phòng có ga và ngày', () => {
    const seasons = [{ months: [11, 12] }, { months: [1, 2, 3] }];
    expect(seasonIndexFor(seasons, 12)).toBe(0);
    expect(seasonIndexFor(seasons, 2)).toBe(1);
    expect(seasonIndexFor(seasons, 6)).toBe(-1);
    expect(weekendHref('da-lat', { checkIn: '2026-11-20', checkOut: '2026-11-22' })).toBe(
      '/?ga=da-lat&checkIn=2026-11-20&checkOut=2026-11-22#search-block',
    );
    expect(weekendHref('da-lat', null)).toBe('/?ga=da-lat#search-block');
  });

  it('nhãn tháng của mùa theo locale', () => {
    expect(monthRange([11, 12], 'vi')).toBe('Tháng 11 – 12');
    expect(monthRange([7], 'vi')).toBe('Tháng 7');
    expect(monthRange([11, 12, 1], 'en')).toBe('November – January');
    expect(monthRange([], 'en')).toBe('');
  });
});

describe('trang hạng sâu hơn', () => {
  it('mọi hạng, mọi locale có đoạn bố cục khoang, không diện tích hay tiền', () => {
    for (const page of ROOM_TYPE_PAGES) {
      for (const locale of LOCALES) {
        const layout = roomTypePageCopy(page.code, locale)?.layout ?? '';
        expect(layout.trim(), `${page.code}/${locale}`).toBeTruthy();
        expect(layout, `${page.code}/${locale}`).not.toMatch(/₫|\bVND\b|\d+\s?m²|\d+\s?m2/);
      }
    }
  });
});
