import { Suspense, type ReactElement } from 'react';
import { RevenueByChannelScreen } from './revenue-channel-screen';

/** SCR-53 — doanh thu theo kênh (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function RevenueByChannelPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RevenueByChannelScreen />
    </Suspense>
  );
}
