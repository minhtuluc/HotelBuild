import { Suspense, type ReactElement } from 'react';
import { RateCalendarScreen } from './rate-calendar-screen';

/** SCR-26 — lịch giá theo ngày và ghi đè giá (F3). Tuyến động vì đọc cấu hình API khi gọi. */
export const dynamic = 'force-dynamic';

export default function RateCalendarPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RateCalendarScreen />
    </Suspense>
  );
}
