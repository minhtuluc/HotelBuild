import { describe, expect, it } from 'vitest';
import { landingContent } from '@pinehill/content/landing-content';
import { slotById } from '@pinehill/content/photo-slots';
import {
  PROPERTY_PAGES,
  matchPropertyId,
  propertyPageByStation,
  propertyPageCopy,
  propertyPageKey,
  searchCtaHref,
} from '@pinehill/content/property-pages';
import {
  ROOM_TYPE_CODES,
  ROOM_TYPE_PAGES,
  roomTypePageCopy,
  roomTypePageKey,
} from '@pinehill/content/room-type-pages';
import { initialPropertyId } from '../../src/app/(guest)/search/public-properties';
import { LOCALES } from '../../src/i18n/locales';

/** HB-310 — nội dung trang ga và trang hạng: đủ locale, ảnh có thật, thông số khớp nội dung trang chủ. */

const PROPERTIES = [
  {
    id: 'p-vt',
    name: 'Pine Hill Vũng Tàu',
    slug: 'vung-tau',
    checkInTime: '14:00',
    checkOutTime: '12:00',
  },
  {
    id: 'p-dl',
    name: 'Pine Hill Đà Lạt',
    slug: 'da-lat',
    checkInTime: '14:00',
    checkOutTime: '12:00',
  },
];

describe('trang ga', () => {
  it('mỗi trang có nội dung cho mọi locale và mã ga có trong tuyến', () => {
    for (const page of PROPERTY_PAGES) {
      for (const locale of LOCALES) {
        const copy = propertyPageCopy(page.slug, locale);
        expect(copy?.summary.trim(), `${page.slug}/${locale}`).toBeTruthy();
        expect(copy?.story.length).toBeGreaterThan(0);
        expect(copy?.legs.length).toBeGreaterThan(0);
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

  it('khớp cơ sở API theo slug (TD-82, HB-311); không khớp thì null', () => {
    const daLat = propertyPageKey('da-lat');
    expect(daLat).toBeDefined();
    if (daLat === undefined) return;
    expect(matchPropertyId(daLat, PROPERTIES)).toBe('p-dl');
    expect(matchPropertyId(daLat, [PROPERTIES[0]!])).toBeNull();
    expect(propertyPageByStation('DL')?.slug).toBe('da-lat');
    expect(propertyPageByStation('PT')?.slug).toBe('phan-thiet');
    expect(propertyPageByStation('VT')?.slug).toBe('vung-tau');
    expect(propertyPageByStation('XX')).toBeUndefined();
    expect(propertyPageKey('khong-co')).toBeUndefined();
  });

  it('CTA về khối tìm phòng mang slug; khối tìm phòng chọn sẵn cơ sở khớp, không khớp thì cơ sở đầu', () => {
    expect(searchCtaHref('da-lat')).toBe('/?ga=da-lat#search-block');
    expect(searchCtaHref(null)).toBe('/#search-block');
    expect(initialPropertyId(PROPERTIES, 'da-lat')).toBe('p-dl');
    // Tên chứa chuỗi không còn khớp: chỉ slug chính xác (đổi tên cơ sở không làm lệch trang ga).
    expect(initialPropertyId(PROPERTIES, 'Đà Lạt')).toBe('p-vt');
    expect(initialPropertyId(PROPERTIES, 'ha-noi')).toBe('p-vt');
    expect(initialPropertyId(PROPERTIES, undefined)).toBe('p-vt');
    expect(initialPropertyId([], 'da-lat')).toBe('');
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

  it('HB-311: đủ năm hạng, số chỗ ngủ theo BR-PROP-04; ba ga trên tuyến đều có trang', () => {
    expect(ROOM_TYPE_PAGES.map((page) => page.code).sort()).toEqual([...ROOM_TYPE_CODES].sort());
    const sleeps = Object.fromEntries(ROOM_TYPE_PAGES.map((page) => [page.code, page.sleeps]));
    expect(sleeps).toEqual({ STD: 2, SUP: 2, DLX: 3, FAM: 4, DOR: 6 });
    for (const station of landingContent('vi').stations) {
      expect(propertyPageByStation(station.code), station.code).toBeDefined();
    }
  });

  it('nội dung trang ở mọi locale không chứa số tiền hay diện tích (giá chỉ ở bước tìm phòng)', () => {
    for (const locale of LOCALES) {
      for (const page of ROOM_TYPE_PAGES) {
        const text = JSON.stringify(roomTypePageCopy(page.code, locale));
        expect(text, `${page.code}/${locale}`).not.toMatch(/₫|\bVND\b|\d+\s?m²|\d+\s?m2/);
      }
      for (const page of PROPERTY_PAGES) {
        const text = JSON.stringify(propertyPageCopy(page.slug, locale));
        expect(text, `${page.slug}/${locale}`).not.toMatch(/₫|\bVND\b/);
      }
    }
  });
});
