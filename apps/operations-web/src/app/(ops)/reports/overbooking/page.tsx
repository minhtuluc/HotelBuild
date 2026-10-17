import { Suspense, type ReactElement } from 'react';
import { OverbookingReportScreen } from './overbooking-report-screen';

/** SCR-55 — quá tải & điều chuyển (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function OverbookingReportPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <OverbookingReportScreen />
    </Suspense>
  );
}
