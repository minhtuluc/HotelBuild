import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { PromotionsScreen } from './promotions-screen';

/** SCR-29 — khuyến mãi (F3). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function PromotionsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <PromotionsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
