import type { ReactElement } from 'react';
import { AccessDeniedPanel } from '@pinehill/ui-web';

/** Tuyến thiếu quyền riêng cho từng shell (F0-04); nội dung không lộ chi tiết đối tượng ngoài phạm vi. */
export default function AccessDeniedPage(): ReactElement {
  return <AccessDeniedPanel backHref="/" />;
}
