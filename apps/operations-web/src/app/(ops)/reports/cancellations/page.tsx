import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { CancellationsReportScreen } from './cancellations-report-screen';

/** SCR-54 — huỷ phòng & hoàn cọc (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function CancellationsReportPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <CancellationsReportScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
