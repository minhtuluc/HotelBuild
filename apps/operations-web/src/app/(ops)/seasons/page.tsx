import { Suspense, type ReactElement } from 'react';
import { SeasonsScreen } from './seasons-screen';

/** SCR-27 — mùa & hệ số (F3). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function SeasonsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <SeasonsScreen />
    </Suspense>
  );
}
