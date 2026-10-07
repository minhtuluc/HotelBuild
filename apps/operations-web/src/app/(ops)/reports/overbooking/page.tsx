import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { OverbookingReportScreen } from './overbooking-report-screen';

/** SCR-55 — quá tải & điều chuyển (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function OverbookingReportPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <OverbookingReportScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
