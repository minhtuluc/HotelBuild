import { Suspense, type ReactElement } from 'react';
import { ProfileScreen } from './profile-screen';

/** SCR-13 — hồ sơ khách & điểm (journey khách), phần chỉ-đọc theo quyết định HB-105. */
export const dynamic = 'force-dynamic';

export default function ProfilePage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ProfileScreen />
    </Suspense>
  );
}
