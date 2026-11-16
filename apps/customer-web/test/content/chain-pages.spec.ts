import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filterGallery } from '../../src/app/(guest)/gallery/gallery-browser';
import {
  EXPERIENCES,
  EVISA_URL,
  LOS_TIERS,
  PLAN_FACTS,
  chainPagesCopy,
  isPlanCode,
} from '../../src/content/chain-pages';
import { galleryEntries, galleryEntry } from '../../src/content/gallery-entries';
import { landingContent } from '../../src/content/landing-content';
import { LOCALES } from '../../src/i18n/locales';

/** HB-311b — trang toàn chuỗi: đủ câu chữ mọi locale, quy tắc giá khớp docs/02 §4.4, thư viện ảnh. */

const RULES = readFileSync(
  fileURLToPath(new URL('../../../../docs/02-nghiep-vu/quy-tac-nghiep-vu.md', import.meta.url)),
  'utf8',
);

function texts(locale: (typeof LOCALES)[number]): string[] {
  const copy = chainPagesCopy(locale);
  return [
    copy.gettingHere.summary,
    ...copy.gettingHere.international,
    copy.gettingHere.seoTitle,
    copy.gettingHere.seoDescription,
    copy.experiences.summary,
    ...Object.values(copy.experiences.items).flatMap((item) => [item.name, item.body]),
    copy.offers.summary,
    copy.offers.losBody,
    ...copy.offers.terms,
    copy.offers.seoTitle,
    copy.gallery.summary,
    copy.gallery.seoTitle,
  ];
}

describe('câu chữ trang toàn chuỗi', () => {
  it('mọi locale đủ câu, mọi hoạt động có tên và mô tả', () => {
    for (const locale of LOCALES) {
      expect(
        texts(locale).filter((text) => text.trim() === ''),
        locale,
      ).toEqual([]);
      const items = chainPagesCopy(locale).experiences.items;
      for (const item of EXPERIENCES) expect(items[item.id], `${locale}.${item.id}`).toBeDefined();
      expect(Object.keys(items).sort(), locale).toEqual(EXPERIENCES.map((item) => item.id).sort());
    }
  });

  it('không số tiền, không mã khuyến mãi, không so sánh với kênh trung gian (Q15)', () => {
    for (const locale of LOCALES) {
      const all = texts(locale).join('\n');
      expect(all, locale).not.toMatch(/₫|\bVND\b|\d{3}\.\d{3}|OTA|Booking\.com|Agoda/);
    }
  });

  it('hoạt động gắn ga có trên tuyến và tháng hợp lệ', () => {
    const codes = landingContent('vi').stations.map((station) => station.code);
    for (const item of EXPERIENCES) {
      expect(codes).toContain(item.stationCode);
      for (const month of item.months ?? []) {
        expect(Number.isInteger(month) && month >= 1 && month <= 12, item.id).toBe(true);
      }
    }
    for (const code of codes) {
      expect(EXPERIENCES.filter((item) => item.stationCode === code).length, code).toBe(3);
    }
  });

  it('thị thực chỉ link tới cổng chính thức (https, tên miền gov.vn)', () => {
    expect(new URL(EVISA_URL).protocol).toBe('https:');
    expect(new URL(EVISA_URL).hostname.endsWith('.gov.vn')).toBe(true);
  });
});

describe('quy tắc giá in trên /offers khớp docs/02 §4.4', () => {
  it('hệ số theo số đêm', () => {
    const line = RULES.split('\n').find((row) => row.startsWith('Áp dụng cho **toàn bộ các đêm**'));
    expect(line).toBeDefined();
    expect(line).toContain('3–6 đêm → **0,95**');
    expect(line).toContain('7–13 đêm → **0,90**');
    expect(line).toContain('≥ 14 đêm → **0,85**');
    expect(LOS_TIERS).toEqual([
      { fromNights: 3, toNights: 6, factor: 0.95 },
      { fromNights: 7, toNights: 13, factor: 0.9 },
      { fromNights: 14, toNights: null, factor: 0.85 },
    ]);
  });

  it('thông số mặc định của bốn gói (số đêm tối thiểu, giảm theo số đêm, đổi ngày)', () => {
    for (const [code, facts] of Object.entries(PLAN_FACTS)) {
      const row = RULES.split('\n').find((line) => line.startsWith(`| \`${code}\` |`));
      expect(row, code).toBeDefined();
      const cells = (row ?? '').split('|').map((cell) => cell.replace(/\*/g, '').trim());
      expect(Number(cells[2]), `${code} minNights`).toBe(facts.minNights);
      expect(cells[4] === 'true', `${code} los`).toBe(facts.losDiscount);
      expect(cells[5]?.includes('phí'), `${code} reschedule`).toBe(facts.reschedule === 'fee');
    }
  });

  it('mọi gói ở trang chủ có thông số', () => {
    for (const locale of LOCALES) {
      for (const plan of landingContent(locale).farePlans) {
        expect(isPlanCode(plan.code), `${locale}.${plan.code}`).toBe(true);
      }
    }
  });
});

describe('thư viện ảnh', () => {
  it('xếp ô ảnh vào nhóm, ga và trang đích', () => {
    expect(galleryEntry('ga-DL-poster')).toMatchObject({
      group: 'poster',
      stationCode: 'DL',
      href: '/stays/da-lat',
      shape: 'tall',
    });
    expect(galleryEntry('ga-VT-canh')).toMatchObject({ group: 'view', shape: 'wide' });
    expect(galleryEntry('ga-PT-phong')).toMatchObject({ group: 'room', href: '/stays/phan-thiet' });
    expect(galleryEntry('hang-DOR')).toMatchObject({
      group: 'class',
      stationCode: null,
      href: '/room-types/DOR',
    });
    expect(galleryEntry('chia-se')).toBeNull();
    expect(galleryEntry('ga-XX-poster')).toBeNull();
    expect(galleryEntries().map((entry) => entry.id)).not.toContain('chia-se');
    expect(galleryEntries().length).toBe(14);
  });

  it('lọc theo ga bỏ ảnh hạng phòng; lọc theo nhóm; kết hợp hai bộ lọc', () => {
    const entries = galleryEntries();
    expect(filterGallery(entries, null, null)).toHaveLength(entries.length);
    expect(filterGallery(entries, 'DL', null).every((entry) => entry.stationCode === 'DL')).toBe(
      true,
    );
    expect(filterGallery(entries, 'DL', null)).toHaveLength(3);
    expect(filterGallery(entries, null, 'class')).toHaveLength(5);
    expect(filterGallery(entries, 'PT', 'class')).toHaveLength(0);
    expect(filterGallery(entries, 'VT', 'view').map((entry) => entry.id)).toEqual(['ga-VT-canh']);
  });
});
