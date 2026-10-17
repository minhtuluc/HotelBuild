import { Suspense, type ReactElement } from 'react';
import { LoyaltyScreen } from './loyalty-screen';

/** SCR-50 — hạng & điểm khách (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function LoyaltyPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <LoyaltyScreen />
    </Suspense>
  );
}
