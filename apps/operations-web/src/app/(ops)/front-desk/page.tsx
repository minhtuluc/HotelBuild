import { Suspense, type ReactElement } from 'react';
import { webEnv } from '../../../config';
import { FrontDeskScreen } from './front-desk-screen';

/** SCR-48 — bàn tiền sảnh (UC-FO-01/02/04). Tuyến động vì đọc cấu hình API tại thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function FrontDeskPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <FrontDeskScreen baseUrl={webEnv().NEXT_PUBLIC_API_BASE_URL} />
    </Suspense>
  );
}
