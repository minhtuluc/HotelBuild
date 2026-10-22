import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../../config';
import { UsersScreen } from './users-screen';

/** SCR-15 — người dùng, vai trò, phạm vi cơ sở (F1). Tuyến động vì đọc cấu hình API tại thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function UsersPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <UsersScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
