/**
 * Khung chung của trang toàn chuỗi (HB-311b): metadata (canonical, hreflang, Open Graph), đầu trang có
 * đường dẫn, `h1`, câu dẫn, và JSON-LD breadcrumb. Component máy chủ.
 */
import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { LOCALE_META, localizePath, type Locale } from '../../i18n/locales';
import { localeAlternates } from '../../i18n/seo';
import type { Translators } from '../../i18n/translate';
import { absoluteUrl } from '../../lib/site';
import { Breadcrumbs } from './breadcrumbs';
import { JsonLd, breadcrumbList } from './json-ld';

export function chainMetadata(
  path: string,
  locale: Locale,
  seo: { readonly seoTitle: string; readonly seoDescription: string },
): Metadata {
  const alternates = localeAlternates(path, locale);
  return {
    title: seo.seoTitle,
    description: seo.seoDescription,
    alternates,
    openGraph: {
      title: seo.seoTitle,
      description: seo.seoDescription,
      url: alternates.canonical,
      locale: LOCALE_META[locale].ogLocale,
    },
  };
}

export function ChainPageHead({
  text,
  path,
  title,
  lede,
  children,
}: {
  text: Translators;
  path: string;
  title: string;
  lede: string;
  children?: ReactNode;
}): ReactElement {
  const { t } = text;
  return (
    <>
      <JsonLd
        data={breadcrumbList([
          { name: t('guest.content.home'), url: absoluteUrl(localizePath('/', text.locale)) },
          { name: title, url: absoluteUrl(localizePath(path, text.locale)) },
        ])}
      />
      <div className="ph-page-shell ph-content-shell">
        <header className="ph-content-head ph-chain-head">
          <div className="ph-content-head-copy">
            <Breadcrumbs
              label={t('guest.content.breadcrumb')}
              items={[{ label: t('guest.content.home'), href: '/' }, { label: title }]}
            />
            <h1 className="ph-content-title">{title}</h1>
            <p className="ph-content-lede">{lede}</p>
          </div>
        </header>
        {children}
      </div>
    </>
  );
}
