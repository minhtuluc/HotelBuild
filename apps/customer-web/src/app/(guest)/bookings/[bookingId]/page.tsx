import { Suspense, type ReactElement } from 'react';
import { BookingDetailScreen } from './booking-detail-screen';

/** SCR-10 — chi tiết booking của tôi (journey khách). Tuyến động: đọc `bookingId` khi gọi. */
export const dynamic = 'force-dynamic';

export default function BookingDetailPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <BookingDetailScreen />
    </Suspense>
  );
}
