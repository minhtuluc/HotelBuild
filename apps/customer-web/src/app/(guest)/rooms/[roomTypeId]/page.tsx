import { Suspense, type ReactElement } from 'react';
import { frontDeskContact } from '../../../../config';
import { RoomDetailScreen } from './room-detail-screen';

/** SCR-03 — chi tiết phòng & giá từng đêm (journey khách). Tuyến động vì đọc truy vấn khi gọi. */
export const dynamic = 'force-dynamic';

export default function RoomDetailPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <RoomDetailScreen contact={frontDeskContact()} />
    </Suspense>
  );
}
