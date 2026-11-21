/**
 * HB-275 — app khách 6 ngôn ngữ như web khách. Bộ khoá tiếng Việt là chuẩn: ngôn ngữ khác phải đủ đúng bộ
 * khoá, giữ nguyên biến `{...}`, không chuỗi rỗng; không câu nào lộ mã nội bộ cho khách.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { LOCALES, type Locale } from '@pinehill/i18n';
import { memoryStorage } from '../src/storage';
import { APP_CATALOGS, catalog, t } from '../src/strings';
import { PAYMENT_CATALOGS, PHASE_CATALOGS, paymentText, phaseText } from '../src/payment/messages';
import {
  LOCALE_KEY,
  chooseLocale,
  currentLocale,
  restoreLocale,
  setLocale,
} from '../src/i18n/locale';
import { formatVnd } from '../src/search';
import { calendarDateLabel } from '../src/calendar-date';

const vars = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
const INTERNAL = /\b(BR|SCR|HB|UC|TC|ADR|NFR|TD)-[A-Z0-9]|\b(PATCH|GET|POST|PUT) \/|ticket|engine/i;

function checkCatalogs(
  name: string,
  all: Readonly<Record<Locale, Readonly<Record<string, string>>>>,
): void {
  const base = all.vi;
  for (const locale of LOCALES) {
    const target = all[locale];
    expect(Object.keys(target).sort(), `${name}/${locale}: bộ khoá`).toEqual(
      Object.keys(base).sort(),
    );
    for (const [key, text] of Object.entries(target)) {
      expect(text.trim(), `${name}/${locale}/${key}: rỗng`).not.toBe('');
      expect(vars(text), `${name}/${locale}/${key}: biến`).toEqual(vars(base[key] ?? ''));
      expect(INTERNAL.test(text), `${name}/${locale}/${key}: lộ mã nội bộ "${text}"`).toBe(false);
    }
  }
}

afterEach(() => setLocale('vi'));

describe('HB-275 danh mục 6 ngôn ngữ', () => {
  it('app, thanh toán và trạng thái thanh toán đủ khoá, đủ biến, không lộ mã nội bộ', () => {
    expect(APP_CATALOGS.vi).toBe(catalog);
    checkCatalogs('app', APP_CATALOGS);
    checkCatalogs('payment', PAYMENT_CATALOGS);
    checkCatalogs('phase', PHASE_CATALOGS);
  });
});

describe('HB-275 đổi ngôn ngữ', () => {
  it('t(), câu thanh toán và định dạng đổi theo ngôn ngữ đang chọn', () => {
    expect(t('nav.search')).toBe('Tìm phòng');
    setLocale('en');
    expect(currentLocale()).toBe('en');
    expect(t('nav.search')).toBe('Search');
    expect(paymentText('title')).toBe('Pay deposit');
    expect(phaseText('confirmed')).toContain('confirmed');
    expect(formatVnd(1_234_000)).toBe('1,234,000');
    setLocale('ja');
    expect(t('nav.bookings')).toBe('予約一覧');
    setLocale('vi');
    expect(formatVnd(1_234_000)).toBe('1.234.000');
    expect(calendarDateLabel('2026-12-24')).toBe('24/12/2026');
  });

  it('lần đầu theo ngôn ngữ máy; lựa chọn đã lưu thắng ngôn ngữ máy', async () => {
    const storage = memoryStorage();
    expect(await restoreLocale(storage, 'ko-KR')).toBe('ko');
    await chooseLocale(storage, 'ru');
    expect(await storage.get(LOCALE_KEY)).toBe('ru');
    setLocale('vi');
    expect(await restoreLocale(storage, 'en-US')).toBe('ru');
  });

  it('giá trị lưu hỏng hoặc kho lưu lỗi thì về ngôn ngữ máy, không chặn app', async () => {
    const broken = memoryStorage();
    await broken.set(LOCALE_KEY, 'xx');
    expect(await restoreLocale(broken, 'zh-Hans-CN')).toBe('zh-CN');
    const failing = { ...memoryStorage(), get: async () => Promise.reject(new Error('locked')) };
    expect(await restoreLocale(failing, undefined)).toBe('vi');
  });
});
