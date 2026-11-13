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
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:px-4 focus:py-2"
            style={{
              backgroundColor: 'var(--color-primary, #1B3A82)',
              color: 'var(--color-primaryContrast, #FFFFFF)',
              minHeight: 'var(--touch-target, 44px)',
              display: 'inline-flex',
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            {operationsCatalog['common.skipToContent']}
          </a>
          <main id="main">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
