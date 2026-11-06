import { Suspense, type ReactElement } from 'react';
import { MergeWalkOutScreen } from '../../../../features/hb137-scr45-46-ghep-walkout/screen';

/** SCR-45/46 — ghép phòng và walk-out (F6, HB-137). Tuyến động vì đọc API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function MergeWalkOutPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <MergeWalkOutScreen />
    </Suspense>
  );
}
