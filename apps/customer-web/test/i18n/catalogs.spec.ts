import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../../src/i18n/catalogs';
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, isLocale } from '../../src/i18n/locales';
import { translatorsFor } from '../../src/i18n/translate';
import { landingContent } from '../../src/content/landing-content';
import { ALL_PHOTO_SLOTS, photoAlt } from '../../src/content/photo-slots';

/** HB-309 — nền tảng i18n customer web: registry đủ khoá, không còn translator toàn cục. */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('registry locale', () => {
  it('locale mặc định là vi và nằm trong LOCALES, mỗi locale có metadata', () => {
    expect(DEFAULT_LOCALE).toBe('vi');
    expect(LOCALES).toContain(DEFAULT_LOCALE);
    for (const locale of LOCALES) {
      expect(LOCALE_META[locale].intl).not.toBe('');
      expect(LOCALE_META[locale].htmlLang).not.toBe('');
    }
    expect(isLocale('vi')).toBe(true);
    expect(isLocale('xx')).toBe(false);
  });

  it('mọi locale có đúng bộ khoá của vi và không có câu rỗng', () => {
    const reference = CATALOGS[DEFAULT_LOCALE];
    for (const locale of LOCALES) {
      for (const part of ['customer', 'account', 'payment'] as const) {
        const catalog = CATALOGS[locale][part];
        expect(Object.keys(catalog).sort()).toEqual(Object.keys(reference[part]).sort());
        for (const [key, value] of Object.entries(catalog)) {
          expect(value.trim(), `${locale}.${part}.${key}`).not.toBe('');
        }
      }
    }
  });

  it('nội dung tĩnh và alt ảnh có đủ cho mọi locale', () => {
    for (const locale of LOCALES) {
      const content = landingContent(locale);
      expect(content.stations.length).toBeGreaterThan(0);
      expect(content.faq.length).toBeGreaterThan(0);
      for (const slot of ALL_PHOTO_SLOTS) expect(photoAlt(slot, locale).trim()).not.toBe('');
    }
  });

  it('translator nội suy biến và cache theo locale', () => {
    const vi = translatorsFor('vi');
    expect(translatorsFor('vi')).toBe(vi);
    expect(vi.t('guest.ticket.segment', { n: 2 })).toContain('2');
    expect(vi.account('loginTitle')).toBe('Đăng nhập');
    expect(vi.payment('summaryBooking', { code: 'PH-1' })).toBe('Đặt phòng PH-1');
  });
});

describe('không còn translator toàn cục', () => {
  const files = sources(SRC);

  it('không file nào import lib/i18n, account/messages hay pay/messages-payment', () => {
    const offenders = files.filter((file) =>
      /from '[^']*(lib\/i18n|account\/messages|\.\/messages|messages-payment)'/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('không file nào gọi makeTranslate ngoài src/i18n', () => {
    const offenders = files.filter(
      (file) =>
        !file.includes(join('src', 'i18n')) &&
        readFileSync(file, 'utf8').includes('makeTranslate('),
    );
    expect(offenders).toEqual([]);
  });
});
