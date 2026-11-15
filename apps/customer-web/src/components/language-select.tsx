'use client';
/**
 * Chọn ngôn ngữ (HB-312, kế hoạch giao diện đợt 5): `<select>` có nhãn hai thứ tiếng, không dùng cờ. Đổi
 * thì sang đúng đường dẫn, tham số và neo hiện tại ở locale kia, tải lại trang để `html lang`, metadata và
 * nội dung máy chủ cùng đổi.
 */
import type { ChangeEvent, ReactElement } from 'react';
import { useLocale } from '../i18n/client';
import {
  LOCALES,
  LOCALE_META,
  isLocale,
  localizePath,
  splitLocale,
  type Locale,
} from '../i18n/locales';

function encodeQuery(search: string): string {
  const pairs = Array.from(new URLSearchParams(search).entries()).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  );
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}

function safeSwitchPath(
  pathname: string,
  search: string,
  hash: string,
  next: Locale,
): string | null {
  const bare = splitLocale(pathname).path;
  const nextPath = localizePath(bare.startsWith('/') && !bare.startsWith('//') ? bare : '/', next);
  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const safeHash = rawHash === '' ? '' : `#${encodeURIComponent(rawHash)}`;
  const target = `${nextPath}${encodeQuery(search)}${safeHash}`;
  return target.startsWith('/') && !target.startsWith('//') ? target : null;
}

export function LanguageSelect(): ReactElement {
  const locale = useLocale();
  const change = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value;
    if (!isLocale(next) || next === locale) return;
    const { pathname, search, hash } = window.location;
    const target = safeSwitchPath(pathname, search, hash, next);
    if (target !== null) window.location.assign(target);
  };
  return (
    <label className="ph-lang">
      <span className="ph-sr-only">Ngôn ngữ · Language</span>
      <select value={locale} onChange={change} data-testid="language-select">
        {LOCALES.map((each) => (
          <option key={each} value={each} lang={LOCALE_META[each].htmlLang}>
            {LOCALE_META[each].label}
          </option>
        ))}
      </select>
    </label>
  );
}
