import type { ReactElement, ReactNode } from 'react';
import type { Metadata } from 'next';
import { tokensToCssVariables } from '@pinehill/ui-web';
import { photoAlt, SHARE_PHOTO } from '../content/photo-slots';
import { photoSrc } from '../lib/photos';
import { GuestFooter, GuestHeader } from '../components/guest-shell';
import { LocaleProvider } from '../i18n/client';
import { LOCALE_META } from '../i18n/locales';
import { requestLocale, serverTranslators } from '../i18n/server';
import './globals.css';

/** Tiêu đề, mô tả và ảnh chia sẻ link (ô ảnh `chia-se`, dùng khi đã có file) theo locale của request. */
export function generateMetadata(): Metadata {
  const { locale, t } = serverTranslators();
  const share = photoSrc(SHARE_PHOTO.id);
  return {
    title: t('guest.app.title'),
    description: t('guest.app.description'),
    ...(share === null
      ? {}
      : {
          openGraph: {
            images: [{ url: share, width: 1200, height: 630, alt: photoAlt(SHARE_PHOTO, locale) }],
          },
        }),
  };
}

export default function GuestLayout({ children }: { children: ReactNode }): ReactElement {
  const locale = requestLocale();
  const { t } = serverTranslators(locale);
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
        </LocaleProvider>
      </body>
    </html>
  );
}
