import { Suspense, type ReactElement } from 'react';
import { RoomTypesScreen } from './room-types-screen';

/** SCR-20 — loại phòng, sức chứa và sàn–trần giá (F2). Tuyến động vì đọc cấu hình API khi gọi. */
export const dynamic = 'force-dynamic';

export default function RoomTypesPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RoomTypesScreen />
    </Suspense>
  );
}
