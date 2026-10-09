import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../../config';
import { RescheduleBookingScreen } from './reschedule-screen';

/** SCR-35 — đổi ngày booking cho back-office (F5). */
export const dynamic = 'force-dynamic';

export default function RescheduleBookingPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RescheduleBookingScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
