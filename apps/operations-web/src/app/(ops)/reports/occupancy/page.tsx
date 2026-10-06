import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { OccupancyReportScreen } from './occupancy-report-screen';

/** SCR-52 — công suất & ADR/RevPAR (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function OccupancyReportPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <OccupancyReportScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
