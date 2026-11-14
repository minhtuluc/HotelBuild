'use client';
/**
 * `next/link` theo locale (HB-312): `href` nội bộ tự thêm tiền tố của locale đang xem (`/en/...`). Link ngoài,
 * neo cùng trang và đường dẫn API giữ nguyên (`localizePath`). Dùng được trong cả server component.
 */
import type { ComponentProps, ReactElement } from 'react';
import Link from 'next/link';
import { useLocale } from '../i18n/client';
import { localizePath } from '../i18n/locales';

type LocaleLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

export function LocaleLink({ href, ...rest }: LocaleLinkProps): ReactElement {
  const locale = useLocale();
  return <Link href={localizePath(href, locale)} {...rest} />;
}
