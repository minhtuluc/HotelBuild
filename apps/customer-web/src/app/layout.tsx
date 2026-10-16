import type { ReactElement, ReactNode } from 'react';
import { I18nProvider, tokensToCssVariables } from '@pinehill/ui-web';
import { customerCatalog } from '../lib/i18n';
import './globals.css';

export const metadata = {
  title: 'Pine Hill — Customer Web',
  description: customerCatalog['guest.app.description'],
};

export default function GuestLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="vi">
      <head>
        <style>{tokensToCssVariables()}</style>
      </head>
      <body>
        <I18nProvider catalog={customerCatalog}>
          <a href="#main">{customerCatalog['common.skipToContent']}</a>
          <main id="main">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
