import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { ReconciliationScreen } from './reconciliation-screen';

/** SCR-39 — Đối soát doanh thu và chốt quỹ cuối ngày (HB-111). */
export const dynamic = 'force-dynamic';

export default function ReconciliationPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <ReconciliationScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
