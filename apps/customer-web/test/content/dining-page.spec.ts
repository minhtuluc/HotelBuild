import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DINING_SERVICES, diningPageCopy, includedCopy } from '../../src/content/dining-page';
import { landingContent } from '../../src/content/landing-content';
import { LOCALES } from '../../src/i18n/locales';

/** HB-318 — trang ăn uống ở ga và khối "Giá đã gồm" đủ ở mọi locale, khớp điều khoản docs/02. */

const TERMS = readFileSync(
  fileURLToPath(new URL('../../../../docs/02-nghiep-vu/tien-nghi-trong-gia.md', import.meta.url)),
  'utf8',
);

function termRows(prefix: string, from: number, to: number): number {
  let count = 0;
  for (let n = from; n <= to; n++) {
    if (TERMS.includes(`| ${prefix}-${String(n).padStart(2, '0')} |`)) count++;
  }
  return count;
}

describe('trang ăn uống ở ga', () => {
  it('mọi locale có đủ ba nhịp, gợi ý cho từng ga và lời dặn, không câu rỗng', () => {
    for (const locale of LOCALES) {
      const copy = diningPageCopy(locale);
      for (const service of DINING_SERVICES) {
        expect(copy.services[service.id].name.trim(), `${locale}.${service.id}`).not.toBe('');
        expect(copy.services[service.id].body.trim(), `${locale}.${service.id}`).not.toBe('');
      }
      for (const station of landingContent(locale).stations) {
        expect(copy.nearby[station.code]?.length, `${locale}.${station.code}`).toBeGreaterThan(0);
      }
      expect(copy.notes.length, locale).toBeGreaterThan(0);
      expect(copy.illustrative).toBe(true);
    }
  });

  it('trạng thái theo điều khoản: trà ở sảnh đã gồm (TN-06), ăn uống khác không (KG-01)', () => {
    const status = Object.fromEntries(DINING_SERVICES.map((item) => [item.id, item.status]));
    expect(status).toEqual({ breakfast: 'extra', tea: 'included', evening: 'none' });
  });
});

describe('khối "Giá đã gồm"', () => {
  it('số mục ở mọi locale bằng số dòng của điều khoản ĐK-TN', () => {
    const shape = {
      included: termRows('TN', 1, 6),
      dorm: termRows('TN', 7, 8),
      excluded: termRows('KG', 1, 4),
    };
    expect(shape).toEqual({ included: 6, dorm: 2, excluded: 4 });
    for (const locale of LOCALES) {
      const copy = includedCopy(locale);
      expect(
        { included: copy.included.length, dorm: copy.dorm.length, excluded: copy.excluded.length },
        locale,
      ).toEqual(shape);
      for (const item of [...copy.included, ...copy.dorm, ...copy.excluded]) {
        expect(item.trim(), locale).not.toBe('');
      }
    }
  });
});
