import type { ReactElement } from 'react';
import { PolicyExceptionsScreen } from '../../../../features/hb138-scr47-ngoai-le-policy/screen';

/** SCR-47 — duyệt ngoại lệ chính sách (F6, HB-138). Tuyến động vì đọc API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function PolicyExceptionsPage(): ReactElement {
  return <PolicyExceptionsScreen />;
}
