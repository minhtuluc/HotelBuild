import { Suspense, type ReactElement } from 'react';
import { BookingResultScreen } from './booking-result-screen';

/** SCR-07 — kết quả đặt phòng & đếm ngược giữ chỗ (journey khách). Tuyến động: đọc `bookingId` khi gọi. */
export const dynamic = 'force-dynamic';

export default function BookingResultPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <BookingResultScreen />
    </Suspense>
  );
}
