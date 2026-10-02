import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { RoomsScreen } from './rooms-screen';

/** SCR-21 — sơ đồ buồng & phòng vật lý (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function RoomsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RoomsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
