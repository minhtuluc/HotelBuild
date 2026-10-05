import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { SeasonsScreen } from './seasons-screen';

/** SCR-27 — mùa & hệ số (F3). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function SeasonsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <SeasonsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
