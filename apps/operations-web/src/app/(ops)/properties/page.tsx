import { Suspense, type ReactElement } from 'react';
import { PropertiesScreen } from './properties-screen';

/**
 * SCR-19 — cơ sở (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi (kiến trúc §7.5);
 * `useSearchParams` cho `?state=` nên cần ranh giới Suspense.
 */
export const dynamic = 'force-dynamic';

export default function PropertiesPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <PropertiesScreen />
    </Suspense>
  );
}
