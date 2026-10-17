import { Suspense, type ReactElement } from 'react';
import { PromotionsScreen } from './promotions-screen';

/** SCR-29 — khuyến mãi (F3). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function PromotionsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <PromotionsScreen />
    </Suspense>
  );
}
