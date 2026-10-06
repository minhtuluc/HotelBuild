import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { RatePlansScreen } from './rate-plans-screen';

/** SCR-70 — gói giá & chính sách huỷ (F3). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function RatePlansPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RatePlansScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
