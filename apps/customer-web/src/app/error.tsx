'use client';

import type { ReactElement } from 'react';
import { ErrorPanel } from '@pinehill/ui-web';

/**
 * Biên lỗi của App Router (F0-04). Không truyền đối tượng lỗi xuống khung hiển thị
 * để không lộ stack trace; chỉ đưa `digest` làm mã tham chiếu cho hỗ trợ.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return <ErrorPanel reset={reset} reference={error.digest} />;
}
