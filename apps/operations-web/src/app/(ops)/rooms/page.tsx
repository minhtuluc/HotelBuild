import { Suspense, type ReactElement } from 'react';
import { RoomsScreen } from './rooms-screen';

/** SCR-21 — sơ đồ buồng & phòng vật lý (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function RoomsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RoomsScreen />
    </Suspense>
  );
}
