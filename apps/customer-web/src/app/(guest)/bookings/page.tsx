import { Suspense, type ReactElement } from 'react';
import { BookingsScreen } from './bookings-screen';

/** SCR-09 — đơn của tôi (journey khách). Tuyến động: đọc bộ lọc trên truy vấn khi gọi. */
export const dynamic = 'force-dynamic';

export default function BookingsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <BookingsScreen />
    </Suspense>
  );
}
