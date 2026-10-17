import { Suspense, type ReactElement } from 'react';
import { NewBookingScreen } from './new-booking-screen';

/** SCR-33/SCR-34 — tạo booking tại quầy / qua điện thoại (F5). */
export const dynamic = 'force-dynamic';

export default function NewBookingPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <NewBookingScreen />
    </Suspense>
  );
}
