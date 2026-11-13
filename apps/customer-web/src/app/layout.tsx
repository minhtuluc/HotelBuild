import type { ReactElement, ReactNode } from 'react';
import type { Metadata } from 'next';
import { SHARE_PHOTO } from '../content/photo-slots';
import { photoSrc } from '../lib/photos';
import { I18nProvider, tokensToCssVariables } from '@pinehill/ui-web';
import { GuestFooter, GuestHeader } from '../components/guest-shell';
import { customerCatalog } from '../lib/i18n';
import './globals.css';

/** Tiêu đề, mô tả và ảnh chia sẻ link (ô ảnh `chia-se`, dùng khi đã có file). */
export function generateMetadata(): Metadata {
  const share = photoSrc(SHARE_PHOTO.id);
  return {
    title: 'Pine Hill · Đặt phòng trực tiếp',
    description: customerCatalog['guest.app.description'],
    ...(share === null
      ? {}
      : {
          openGraph: { images: [{ url: share, width: 1200, height: 630, alt: SHARE_PHOTO.alt }] },
        }),
  };
}

export default function GuestLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="vi">
      <head>
        <style>{tokensToCssVariables()}</style>
      </head>
      <body>
        <I18nProvider catalog={customerCatalog}>
          <a href="#main" className="ph-skip-link">
            {customerCatalog['common.skipToContent']}
          </a>
          <GuestHeader />
          <main id="main">{children}</main>
          <GuestFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
