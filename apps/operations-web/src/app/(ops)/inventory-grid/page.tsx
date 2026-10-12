import { Suspense, type ReactElement } from 'react';
import { InventoryGridScreen } from './inventory-grid-screen';

/** SCR-24 — lưới tồn phòng theo ngày (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function InventoryGridPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <InventoryGridScreen />
    </Suspense>
  );
}
