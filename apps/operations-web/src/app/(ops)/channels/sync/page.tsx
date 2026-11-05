import type { ReactElement } from 'react';
import { ChannelSyncScreen } from '../../../../features/hb133-scr41-giam-sat-dong-bo/screen';

/** SCR-41 — giám sát đồng bộ kênh và outbox (F6, HB-133). Tuyến động vì đọc API ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function ChannelSyncPage(): ReactElement {
  return <ChannelSyncScreen />;
}
