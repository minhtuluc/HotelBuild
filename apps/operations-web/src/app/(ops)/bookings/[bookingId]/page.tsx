import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { BookingScreen } from './booking-screen';

/** SCR-32 — chi tiết booking (F5). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function BookingPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <BookingScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
