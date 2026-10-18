import { Suspense, type ReactElement } from 'react';
import { ChannelsScreen } from './channels-screen';

/** SCR-28 — kênh: hệ số & hoa hồng (F3). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function ChannelsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ChannelsScreen />
    </Suspense>
  );
}
