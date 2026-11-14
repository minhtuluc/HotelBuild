/**
 * Đường dẫn trang nội dung (DESIGN.md › Content Pages › Breadcrumbs): một dòng nhỏ trên `h1`, trang hiện
 * tại không là liên kết và có `aria-current="page"`. Dấu "›" chỉ để nhìn (`aria-hidden`).
 */
import type { ReactElement } from 'react';
import { LocaleLink as Link } from '../locale-link';

export interface Crumb {
  readonly label: string;
  /** Không có `href` = trang hiện tại. */
  readonly href?: string;
}

export function Breadcrumbs({
  items,
  label,
}: {
  items: readonly Crumb[];
  label: string;
}): ReactElement {
  return (
    <nav aria-label={label} className="ph-crumbs">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 ? (
              <span className="ph-crumb-sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            {item.href === undefined ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <Link href={item.href}>{item.label}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
