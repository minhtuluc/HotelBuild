import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { RoomBlocksScreen } from './room-blocks-screen';

/** SCR-22 — khoá phòng bảo trì/ngừng bán (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function RoomBlocksPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RoomBlocksScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
