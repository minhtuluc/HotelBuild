import type { ReactElement } from 'react';
import { AccessDeniedPanel } from '@pinehill/ui-web';

/** Tuyến thiếu quyền riêng cho từng shell (F0-04); nội dung không lộ chi tiết đối tượng ngoài phạm vi. */
export default function AccessDeniedPage(): ReactElement {
  return (
    <div
      style={{
        maxWidth: 640,
        marginInline: 'auto',
        padding: 'clamp(2rem, 5vw, 4rem) var(--space-s4, 16px)',
      }}
    >
      <AccessDeniedPanel backHref="/" />
    </div>
  );
}
