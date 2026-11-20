import { describe, expect, it } from 'vitest';
import { EXPERIENCES } from '@pinehill/content/chain-pages';
import { DINING_SERVICES } from '@pinehill/content/dining-page';
import { photoAlt, slotById } from '@pinehill/content/photo-slots';
import { EXTRA_PHOTOS } from '@pinehill/content/photo-slots-extra';
import { ROOM_TYPE_PAGES } from '@pinehill/content/room-type-pages';
import { LOCALES } from '../../src/i18n/locales';
import { photoSrc } from '../../src/lib/photos';

/** HB-326 — ô ảnh minh hoạ cho hoạt động, ăn uống và ảnh nhiều góc của hạng: khớp mã, có file, có alt. */

describe('ô ảnh minh hoạ thêm', () => {
  it('mỗi hoạt động, mỗi dịch vụ ăn uống có đúng một ô ảnh; mỗi hạng có ba ảnh trong gallery', () => {
    const ids = EXTRA_PHOTOS.map((slot) => slot.id).sort();
    const expected = [
      ...EXPERIENCES.map((item) => `tn-${item.id}`),
      ...DINING_SERVICES.map((service) => `an-${service.id}`),
      ...ROOM_TYPE_PAGES.flatMap((page) => [`hang-${page.code}-2`, `hang-${page.code}-3`]),
    ].sort();
    expect(ids).toEqual(expected);
    for (const page of ROOM_TYPE_PAGES) {
      expect(page.galleryIds, page.code).toEqual([
        `hang-${page.code}`,
        `hang-${page.code}-2`,
        `hang-${page.code}-3`,
      ]);
    }
  });

  it('mọi ô có file ảnh và alt khác rỗng ở cả sáu ngôn ngữ', () => {
    for (const slot of EXTRA_PHOTOS) {
      expect(photoSrc(slot.id), slot.id).toBe(`/images/pine-hill/${slot.id}.webp`);
      expect(slotById(slot.id)?.ratio).toBe('4/3');
      for (const locale of LOCALES) {
        expect(photoAlt(slot, locale).trim(), `${slot.id}/${locale}`).not.toBe('');
      }
    }
  });
});
