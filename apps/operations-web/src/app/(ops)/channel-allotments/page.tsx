import { Suspense, type ReactElement } from 'react';
import { ChannelAllotmentsScreen } from './channel-allotments-screen';

/** SCR-25 — allotment theo kênh (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function ChannelAllotmentsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ChannelAllotmentsScreen />
    </Suspense>
  );
}
