import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { RateCalendarScreen } from './rate-calendar-screen';

/** SCR-26 — lịch giá theo ngày và ghi đè giá (F3). Tuyến động vì đọc cấu hình API khi gọi. */
export const dynamic = 'force-dynamic';

export default function RateCalendarPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RateCalendarScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
