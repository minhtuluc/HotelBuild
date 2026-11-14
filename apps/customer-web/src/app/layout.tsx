import type { ReactElement, ReactNode } from 'react';
import type { Metadata } from 'next';
import { tokensToCssVariables } from '@pinehill/ui-web';
import { photoAlt, SHARE_PHOTO } from '../content/photo-slots';
import { photoSrc } from '../lib/photos';
import { siteOrigin } from '../lib/site';
import { GuestFooter, GuestHeader } from '../components/guest-shell';
import { ScrollReveal } from '../components/scroll-reveal';
import { LocaleProvider } from '../i18n/client';
import { LOCALE_META } from '../i18n/locales';
import { localeAlternates } from '../i18n/seo';
import { requestLocale, requestPath, serverTranslators } from '../i18n/server';
import './globals.css';
import './content-pages.css';
import './motion.css';

/**
 * Tiêu đề, mô tả, ảnh chia sẻ, canonical và `hreflang` theo locale của request (HB-312). Trang con có
 * metadata riêng thì ghi đè tiêu đề/mô tả; `alternates` ở đây áp cho mọi trang chưa tự khai báo.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await serverTranslators();
  const share = photoSrc(SHARE_PHOTO.id);
  const origin = siteOrigin();
  return {
    ...(origin === null ? {} : { metadataBase: new URL(origin) }),
    title: t('guest.app.title'),
    description: t('guest.app.description'),
    alternates: localeAlternates(await requestPath(), locale),
    openGraph: {
      locale: LOCALE_META[locale].ogLocale,
      ...(share === null
        ? {}
        : {
            images: [{ url: share, width: 1200, height: 630, alt: photoAlt(SHARE_PHOTO, locale) }],
          }),
    },
  };
}

export default async function GuestLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const locale = await requestLocale();
  const { t } = await serverTranslators(locale);
  return (
    <html lang={LOCALE_META[locale].htmlLang}>
      <head>
        <style>{tokensToCssVariables()}</style>
      </head>
      <body>
        <LocaleProvider locale={locale}>
          <a href="#main" className="ph-skip-link">
            {t('common.skipToContent')}
          </a>
          <GuestHeader />
          <main id="main">{children}</main>
          <GuestFooter />
          <ScrollReveal />
        </LocaleProvider>
      </body>
    </html>
  );
}
