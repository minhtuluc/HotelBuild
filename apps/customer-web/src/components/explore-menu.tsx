'use client';
/**
 * Menu "Khám phá" trên header (HB-311b, CONT-08): nút mở bảng link tới mọi trang nội dung. Dưới 760 px bảng
 * thành ngăn kéo toàn chiều ngang. `aria-expanded` + `aria-controls`; Esc hoặc bấm ra ngoài thì đóng, Esc trả
 * tiêu điểm về nút. Link do header (máy chủ) dựng sẵn theo locale.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { LocaleLink } from './locale-link';

export interface ExploreLink {
  readonly href: string;
  readonly label: string;
}

export interface ExploreGroup {
  readonly title: string;
  readonly links: readonly ExploreLink[];
}

export function ExploreMenu({
  label,
  title,
  closeLabel,
  groups,
}: {
  label: string;
  title: string;
  closeLabel: string;
  groups: readonly ExploreGroup[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent): void => {
      const node = root.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div className="ph-explore" ref={root}>
      <button
        ref={button}
        type="button"
        className="ph-nav-link ph-explore-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        data-testid="explore-toggle"
      >
        {label}
        <span className="ph-explore-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <div
        id={panelId}
        className="ph-explore-panel"
        hidden={!open}
        role="region"
        aria-label={title}
        data-testid="explore-panel"
      >
        {groups.map((group) => (
          <div key={group.title} className="ph-explore-group">
            <p className="ph-explore-title">{group.title}</p>
            <ul>
              {group.links.map((link) => (
                <li key={link.href}>
                  <LocaleLink
                    href={link.href}
                    className="ph-explore-link"
                    onClick={() => setOpen(false)}
                  >
                    {link.label}
                  </LocaleLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button
          type="button"
          className="ph-btn ph-explore-close"
          onClick={() => {
            setOpen(false);
            button.current?.focus();
          }}
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
