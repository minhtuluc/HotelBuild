import { Suspense, type ReactElement } from 'react';
import { CancelScreen } from './cancel-screen';

/** SCR-11 — huỷ đặt phòng & số tiền hoàn theo bậc (journey khách). Tuyến động: đọc `bookingId` khi gọi. */
export const dynamic = 'force-dynamic';

export default function CancelPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <CancelScreen />
    </Suspense>
  );
}
