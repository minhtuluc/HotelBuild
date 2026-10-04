import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { AuditLogsScreen } from './audit-logs-screen';

/** SCR-16 — nhật ký kiểm toán (F2). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function AuditLogsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <AuditLogsScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
