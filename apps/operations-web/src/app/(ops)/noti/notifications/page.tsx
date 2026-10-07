import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { NotificationsScreen } from './notifications-screen';

/** SCR-51 — mẫu & hàng đợi thông báo (F8). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function NotificationsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <NotificationsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
