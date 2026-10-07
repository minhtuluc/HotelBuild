import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { SystemSettingsScreen } from './system-settings-screen';

/** SCR-17 — tham số hệ thống (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function SystemSettingsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <SystemSettingsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
