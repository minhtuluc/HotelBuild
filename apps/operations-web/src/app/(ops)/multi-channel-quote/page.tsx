import { Suspense, type ReactElement } from 'react';
import { MultiChannelQuoteScreen } from './multi-channel-quote-screen';

/** SCR-30 — xem trước báo giá đa kênh (F3). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function MultiChannelQuotePage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <MultiChannelQuoteScreen />
    </Suspense>
  );
}
