/** Phủ mọi module nội dung: mỗi ngôn ngữ có đủ trang chuỗi/ẩm thực/landing, các hàm tra cứu trả đúng. */
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@pinehill/i18n';
import { chainPagesCopy, isPlanCode } from '../src/chain-pages';
import { diningPageCopy, includedCopy } from '../src/dining-page';
import { galleryEntries, galleryEntry } from '../src/gallery-entries';
import { landingContent } from '../src/landing-content';
import { ALL_PHOTO_SLOTS, photoAlt, slotById } from '../src/photo-slots';
import {
  PROPERTY_PAGES,
  matchPropertyId,
  propertyPageByStation,
  propertyPageKey,
  searchCtaHref,
} from '../src/property-pages';
import { isRoomTypeCode } from '../src/room-type-codes';
import { ROOM_TYPE_PAGES, roomTypePageKey } from '../src/room-type-pages';
import { viContent } from '../src/catalogs/vi';
import { jaContent } from '../src/catalogs/ja';
import { koContent } from '../src/catalogs/ko';
import { ruContent } from '../src/catalogs/ru';
import { zhContent } from '../src/catalogs/zh-cn';

describe('nội dung theo ngôn ngữ', () => {
  it('trang chuỗi, ẩm thực, “đã gồm”, landing có ở cả 6 ngôn ngữ', () => {
    for (const locale of LOCALES) {
      expect(chainPagesCopy(locale), locale).toBeDefined();
      expect(diningPageCopy(locale), locale).toBeDefined();
      expect(includedCopy(locale), locale).toBeDefined();
      expect(landingContent(locale), locale).toBeDefined();
    }
  });

  it('catalog ja/ko/ru/zh đủ khoá như tiếng Việt', () => {
    const keys = Object.keys(viContent).sort();
    for (const catalog of [jaContent, koContent, ruContent, zhContent])
      expect(Object.keys(catalog).sort()).toEqual(keys);
  });

  it('chú thích ảnh có ở mọi ngôn ngữ, rơi về tiếng Anh khi thiếu', () => {
    const slot = ALL_PHOTO_SLOTS[0];
    expect(slot).toBeDefined();
    if (slot === undefined) return;
    for (const locale of LOCALES) expect(photoAlt(slot, locale).length).toBeGreaterThan(0);
  });
});

describe('hàm tra cứu', () => {
  it('ô ảnh và mục thư viện', () => {
    const first = ALL_PHOTO_SLOTS[0];
    expect(first && slotById(first.id)).toBe(first);
    expect(slotById('khong-co')).toBeUndefined();
    expect(galleryEntries().length).toBeGreaterThan(0);
    expect(galleryEntry('khong-co')).toBeNull();
  });

  it('trang ga theo slug/mã ga, khớp id cơ sở, link tìm phòng', () => {
    const page = PROPERTY_PAGES[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    expect(propertyPageKey(page.slug)).toBe(page);
    expect(propertyPageByStation(page.stationCode)).toBe(page);
    expect(propertyPageKey('khong-co')).toBeUndefined();
    expect(matchPropertyId(page, [{ id: 'p-1', slug: page.slug }])).toBe('p-1');
    expect(matchPropertyId(page, [])).toBeNull();
    expect(searchCtaHref(null)).toBe('/#search-block');
    expect(searchCtaHref('da lat')).toBe('/?ga=da%20lat#search-block');
  });

  it('mã hạng phòng và gói giá', () => {
    const room = ROOM_TYPE_PAGES[0];
    expect(room && roomTypePageKey(room.code)).toBe(room);
    expect(roomTypePageKey('XXX')).toBeUndefined();
    expect(isRoomTypeCode('STD')).toBe(true);
    expect(isRoomTypeCode('XXX')).toBe(false);
    expect(isPlanCode('FLEX7')).toBe(true);
    expect(isPlanCode('XXX')).toBe(false);
  });
});
