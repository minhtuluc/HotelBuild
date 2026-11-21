/** HB-277 — nội dung dùng chung web + app: đủ 6 ngôn ngữ, mọi ga/hạng có câu chữ, ô ảnh tham chiếu có thật. */
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@pinehill/i18n';
import { viContent } from '../src/catalogs/vi';
import { enContent } from '../src/catalogs/en';
import { PROPERTY_PAGES, propertyPageCopy } from '../src/property-pages';
import { ROOM_TYPE_PAGES, roomTypePageCopy } from '../src/room-type-pages';
import { ALL_PHOTO_SLOTS } from '../src/photo-slots';
import { EXTRA_PHOTOS } from '../src/photo-slots-extra';

describe('HB-277 nội dung dùng chung', () => {
  it('catalog nội dung tiếng Anh đủ khoá tiếng Việt', () => {
    expect(Object.keys(enContent).sort()).toEqual(Object.keys(viContent).sort());
  });

  it('mọi ga và hạng phòng có câu chữ ở cả 6 ngôn ngữ', () => {
    for (const locale of LOCALES) {
      for (const page of PROPERTY_PAGES)
        expect(propertyPageCopy(page.slug, locale), `${page.slug}/${locale}`).toBeDefined();
      for (const page of ROOM_TYPE_PAGES)
        expect(roomTypePageCopy(page.code, locale), `${page.code}/${locale}`).toBeDefined();
    }
  });

  it('ô ảnh được trang ga/hạng tham chiếu đều có trong danh mục ảnh', () => {
    const known = new Set([...ALL_PHOTO_SLOTS, ...EXTRA_PHOTOS].map((slot) => slot.id));
    for (const page of [...PROPERTY_PAGES, ...ROOM_TYPE_PAGES])
      for (const id of page.galleryIds) expect(known.has(id), id).toBe(true);
  });
});
