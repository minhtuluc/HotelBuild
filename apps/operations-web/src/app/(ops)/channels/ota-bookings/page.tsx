import type { ReactElement } from 'react';
import { OtaBookingsScreen } from '../../../../features/hb134-scr42-booking-ota/screen';

/** SCR-42 — hàng đợi booking OTA nhận vào (F6, HB-134). Tuyến động vì đọc API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function OtaBookingsPage(): ReactElement {
  return <OtaBookingsScreen />;
}
