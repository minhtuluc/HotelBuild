import { Suspense, type ReactElement } from 'react';
import { RescheduleScreen } from './reschedule-screen';

/** SCR-12 — đổi ngày lưu trú (journey khách). Tuyến động: đọc `bookingId` khi gọi. */
export const dynamic = 'force-dynamic';

export default function ReschedulePage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RescheduleScreen />
    </Suspense>
  );
}
