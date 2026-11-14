'use client';
/**
 * Chọn ngôn ngữ (HB-312, kế hoạch giao diện đợt 5): `<select>` có nhãn hai thứ tiếng, không dùng cờ. Đổi
 * thì sang đúng đường dẫn, tham số và neo hiện tại ở locale kia, tải lại trang để `html lang`, metadata và
 * nội dung máy chủ cùng đổi.
 */
import type { ChangeEvent, ReactElement } from 'react';
import { useLocale } from '../i18n/client';
import { LOCALES, LOCALE_META, isLocale, localizePath, splitLocale } from '../i18n/locales';

export function LanguageSelect(): ReactElement {
  const locale = useLocale();
  const change = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value;
    if (!isLocale(next) || next === locale) return;
    const { pathname, search, hash } = window.location;
    window.location.assign(localizePath(`${splitLocale(pathname).path}${search}${hash}`, next));
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
