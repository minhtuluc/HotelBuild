import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { BookingsScreen } from './bookings-screen';

/** SCR-31 — danh sách & tra cứu booking (F5). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function BookingsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <BookingsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
