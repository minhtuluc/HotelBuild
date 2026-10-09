import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { NewBookingScreen } from './new-booking-screen';

/** SCR-33/SCR-34 — tạo booking tại quầy / qua điện thoại (F5). */
export const dynamic = 'force-dynamic';

export default function NewBookingPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <NewBookingScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
