/**
 * HB-275 — ngôn ngữ đang dùng của app khách (6 ngôn ngữ như web khách, `@pinehill/i18n`).
 * Lần đầu theo ngôn ngữ của máy; khách đổi ở tab Tài khoản thì lưu lại và lựa chọn đó thắng ngôn ngữ máy.
 * Store ở cấp module để `t()` đọc trực tiếp; layout gốc đăng ký `subscribeLocale` và vẽ lại cả cây khi đổi.
 */
import { DEFAULT_LOCALE, isLocale, matchLocale, type Locale } from '@pinehill/i18n';
import type { KeyValueStorage } from '../storage';

export const LOCALE_KEY = 'app.locale';

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

export function currentLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Thẻ ngôn ngữ của máy (Hermes có `Intl`); không đọc được thì để `matchLocale` về tiếng Việt. */
export function deviceLocaleTag(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/** Khôi phục lúc mở app. Kho lưu lỗi hoặc giá trị lạ thì theo ngôn ngữ máy, không chặn app. */
export async function restoreLocale(
  storage: KeyValueStorage,
  deviceTag: string | undefined,
): Promise<Locale> {
  const saved = await storage.get(LOCALE_KEY).catch(() => null);
  const next = saved !== null && isLocale(saved) ? saved : matchLocale(deviceTag);
  setLocale(next);
  return next;
}

/** Khách chọn ngôn ngữ: đổi ngay, rồi lưu. Lưu lỗi thì vẫn giữ ngôn ngữ đã chọn trong phiên. */
export async function chooseLocale(storage: KeyValueStorage, next: Locale): Promise<void> {
  setLocale(next);
  await storage.set(LOCALE_KEY, next).catch(() => undefined);
}
