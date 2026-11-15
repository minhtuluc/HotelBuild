/**
 * Cuống vé dính đáy (DESIGN.md › Content Pages › Sticky Booking Stub): chỉ hiện dưới 760px (CSS), cao 52px
 * + vùng an toàn; `body` thêm đệm đáy tương ứng để không che nội dung cuối, kể cả chân trang. Trên màn rộng
 * CTA nằm ở đầu và cuối trang nên dải này ẩn.
 */
import type { ReactElement } from 'react';
import { JourneyCta, type JourneyKind } from './journey-cta';

export function StickyBookingStub({
  title,
  page,
  href,
  cta,
}: {
  title: string;
  /** Trang đang xem: nút giữ ngữ cảnh hành trình trên URL như nút đầu trang (HB-317). */
  page: JourneyKind;
  href: string;
  cta: string;
}): ReactElement {
  return (
    <div className="ph-sticky-stub" data-testid="sticky-stub">
      <span className="ph-sticky-stub-title">{title}</span>
      <JourneyCta page={page} fallbackHref={href} label={cta} className="ph-btn ph-btn-accent" />
    </div>
  );
}
