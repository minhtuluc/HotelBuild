import { describe, expect, it } from 'vitest';
import { landingContent } from '../../src/content/landing-content';
import { slotById } from '../../src/content/photo-slots';
import {
  PROPERTY_PAGES,
  matchPropertyId,
  propertyPageByStation,
  propertyPageCopy,
  propertyPageKey,
  searchCtaHref,
} from '../../src/content/property-pages';
import {
  ROOM_TYPE_CODES,
  ROOM_TYPE_PAGES,
  roomTypePageCopy,
  roomTypePageKey,
} from '../../src/content/room-type-pages';
import { initialPropertyId } from '../../src/app/(guest)/search/public-properties';
import { LOCALES } from '../../src/i18n/locales';

/** HB-310 — nội dung trang ga và trang hạng: đủ locale, ảnh có thật, thông số khớp nội dung trang chủ. */

const PROPERTIES = [
  { id: 'p-vt', name: 'Pine Hill Vũng Tàu', checkInTime: '14:00', checkOutTime: '12:00' },
  { id: 'p-dl', name: 'Pine Hill Đà Lạt', checkInTime: '14:00', checkOutTime: '12:00' },
];

describe('trang ga', () => {
  it('mỗi trang có nội dung cho mọi locale và mã ga có trong tuyến', () => {
    for (const page of PROPERTY_PAGES) {
      for (const locale of LOCALES) {
        const copy = propertyPageCopy(page.slug, locale);
        expect(copy?.summary.trim(), `${page.slug}/${locale}`).toBeTruthy();
        expect(copy?.story.length).toBeGreaterThan(0);
        expect(copy?.arrival.length).toBeGreaterThan(0);
        const codes = landingContent(locale).stations.map((station) => station.code);
        expect(codes).toContain(page.stationCode);
      }
    }
  });

  it('ô ảnh của áp phích và gallery có trong danh mục ô ảnh', () => {
    for (const page of PROPERTY_PAGES) {
      expect(slotById(page.posterPhotoId)).toBeDefined();
      for (const id of page.galleryIds) expect(slotById(id), id).toBeDefined();
    }
  });

  it('hạng nổi bật là hạng có thật trên trang chủ', () => {
    const codes = landingContent('vi').cabinClasses.map((cabin) => cabin.code);
    for (const page of PROPERTY_PAGES) {
      for (const code of page.featuredRoomCodes) expect(codes).toContain(code);
    }
  });

  it('khớp cơ sở API theo tên ga; không khớp thì null', () => {
    const daLat = propertyPageKey('da-lat');
    expect(daLat).toBeDefined();
    if (daLat === undefined) return;
    expect(matchPropertyId(daLat, PROPERTIES)).toBe('p-dl');
    expect(matchPropertyId(daLat, [PROPERTIES[0]!])).toBeNull();
    expect(propertyPageByStation('DL')?.slug).toBe('da-lat');
    expect(propertyPageByStation('PT')).toBeUndefined();
    expect(propertyPageKey('khong-co')).toBeUndefined();
  });

  it('CTA về khối tìm phòng mang slug; khối tìm phòng chọn sẵn cơ sở khớp, không khớp thì cơ sở đầu', () => {
    expect(searchCtaHref('da-lat')).toBe('/?ga=da-lat#search-block');
    expect(searchCtaHref(null)).toBe('/#search-block');
    expect(initialPropertyId(PROPERTIES, 'Đà Lạt')).toBe('p-dl');
    expect(initialPropertyId(PROPERTIES, 'Hà Nội')).toBe('p-vt');
    expect(initialPropertyId(PROPERTIES, undefined)).toBe('p-vt');
    expect(initialPropertyId([], 'Đà Lạt')).toBe('');
  });
});

describe('trang hạng', () => {
  it('mã hạng hợp lệ, có nội dung mọi locale, ga phục vụ có trong tuyến', () => {
    for (const page of ROOM_TYPE_PAGES) {
      expect(ROOM_TYPE_CODES).toContain(page.code);
      expect(page.sleeps).toBeGreaterThan(0);
      expect(slotById(page.photoId)).toBeDefined();
      for (const id of page.galleryIds) expect(slotById(id), id).toBeDefined();
      for (const locale of LOCALES) {
        expect(roomTypePageCopy(page.code, locale)?.summary.trim()).toBeTruthy();
        const codes = landingContent(locale).stations.map((station) => station.code);
        for (const code of page.stationCodes) expect(codes).toContain(code);
      }
    }
    expect(roomTypePageKey('DLX')?.sleeps).toBe(3);
    expect(roomTypePageKey('XYZ')).toBeUndefined();
  });

  it('nội dung trang không chứa số tiền hay diện tích (giá chỉ ở bước tìm phòng)', () => {
    for (const page of ROOM_TYPE_PAGES) {
      const copy = roomTypePageCopy(page.code, 'vi');
      const text = JSON.stringify(copy);
      expect(text).not.toMatch(/₫|\bVND\b|\d+\s?m²|\d+\s?m2/);
    }
    for (const page of PROPERTY_PAGES) {
      expect(JSON.stringify(propertyPageCopy(page.slug, 'vi'))).not.toMatch(/₫|\bVND\b/);
    }
  });
});
