import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { GuestsScreen } from './guests-screen';

/** SCR-49 — hồ sơ khách & danh sách đen (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function GuestsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <GuestsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
