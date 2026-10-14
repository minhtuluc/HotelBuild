import type { ReactElement, ReactNode } from 'react';
import { I18nProvider, tokensToCssVariables } from '@pinehill/ui-web';
import { operationsCatalog } from '../lib/i18n';
import './globals.css';

export const metadata = {
  title: 'Pine Hill — Operations Web',
  description: operationsCatalog['ops.app.description'],
};

export default function OperationsLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="vi">
      <head>
        <style>{tokensToCssVariables()}</style>
      </head>
      <body>
        <I18nProvider catalog={operationsCatalog}>
          <a href="#main">{operationsCatalog['common.skipToContent']}</a>
          <main id="main">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
