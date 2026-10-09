import { Suspense, type ReactElement } from 'react';
import { BookScreen } from './book-screen';

/** SCR-04/SCR-05 — chọn gói, thông tin khách & xác nhận (journey khách, bước 4/4). */
export const dynamic = 'force-dynamic';

export default function BookPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <BookScreen />
    </Suspense>
  );
}
