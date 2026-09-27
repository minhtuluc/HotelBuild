'use client';

import type { ReactElement } from 'react';
import { ErrorPanel } from '@pinehill/ui-web';
import './globals.css';

/** Biên lỗi toàn cục: lỗi ở chính layout gốc vẫn phải hiện thông báo an toàn (F0-04). */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return (
    <html lang="vi">
      <body>
        <ErrorPanel reset={reset} />
      </body>
    </html>
  );
}
