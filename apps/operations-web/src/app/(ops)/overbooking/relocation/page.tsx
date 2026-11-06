import { Suspense, type ReactElement } from 'react';
import { RelocationScreen } from '../../../../features/hb136-scr44-dieu-chuyen/screen';

/** SCR-44 — đề xuất và thực hiện điều chuyển (F6, HB-136). Tuyến động vì đọc API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function RelocationPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RelocationScreen />
    </Suspense>
  );
}
