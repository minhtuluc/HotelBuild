/**
 * Cuống vé dính đáy (DESIGN.md › Content Pages › Sticky Booking Stub): chỉ hiện dưới 760px (CSS), cao 52px
 * + vùng an toàn; `body` thêm đệm đáy tương ứng để không che nội dung cuối, kể cả chân trang. Trên màn rộng
 * CTA nằm ở đầu và cuối trang nên dải này ẩn.
 */
import type { ReactElement } from 'react';
import Link from 'next/link';

export function StickyBookingStub({
  title,
  href,
  cta,
}: {
  title: string;
  href: string;
  cta: string;
}): ReactElement {
  return (
    <div className="ph-sticky-stub" data-testid="sticky-stub">
      <span className="ph-sticky-stub-title">{title}</span>
      <Link href={href} className="ph-btn ph-btn-accent">
        {cta}
      </Link>
    </div>
  );
}
