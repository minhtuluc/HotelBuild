import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../../config';
import { CancelScreen } from './cancel-screen';

/** SCR-36 — huỷ booking & tính hoàn theo bậc (F5). */
export const dynamic = 'force-dynamic';

export default function CancelBookingPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <CancelScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
