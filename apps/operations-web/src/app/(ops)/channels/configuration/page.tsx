import type { ReactElement } from 'react';
import { ChannelConfigurationScreen } from '../../../../features/hb132-scr40-cau-hinh-kenh/screen';

/** SCR-40 — cấu hình kênh bán (F6, HB-132). Tuyến động vì đọc cấu hình API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function ChannelConfigurationPage(): ReactElement {
  return <ChannelConfigurationScreen />;
}
