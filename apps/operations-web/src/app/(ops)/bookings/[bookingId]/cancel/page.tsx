import { Suspense, type ReactElement } from 'react';
import { CancelScreen } from './cancel-screen';

/** SCR-36 — huỷ booking & tính hoàn theo bậc (F5). */
export const dynamic = 'force-dynamic';

export default function CancelBookingPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <CancelScreen />
    </Suspense>
  );
}
