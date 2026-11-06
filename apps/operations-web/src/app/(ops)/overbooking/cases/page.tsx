import type { ReactElement } from 'react';
import { OverbookingCasesScreen } from '../../../../features/hb135-scr43-bang-qua-tai/screen';

/** SCR-43 — bảng điều khiển quá tải (F6, HB-135). Tuyến động vì đọc API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function OverbookingCasesPage(): ReactElement {
  return <OverbookingCasesScreen />;
}
