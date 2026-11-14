'use client';
/**
 * Gallery + lightbox (DESIGN.md › Content Pages › Gallery + Lightbox).
 *
 * Mỗi ảnh là một nút; lightbox là `<dialog>` gốc mở bằng `showModal()` nên trình duyệt lo khoá tiêu điểm,
 * nền và phím Esc. ← → chuyển ảnh; đóng xong trả tiêu điểm về nút ảnh đã mở. Một ảnh thì không có lưới.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useT } from '../../i18n/client';

export interface GalleryItem {
  readonly id: string;
  readonly src: string;
  readonly alt: string;
}

function wrap(index: number, length: number): number {
  return (index + length) % length;
}

function Lightbox({
  items,
  index,
  onMove,
  onClose,
}: {
  items: readonly GalleryItem[];
  index: number;
  onMove: (next: number) => void;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const item = items[index];
  useEffect(() => {
    const node = dialog.current;
    if (node !== null && !node.open) node.showModal();
  }, []);
  const keys = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === 'ArrowRight') onMove(wrap(index + 1, items.length));
    if (event.key === 'ArrowLeft') onMove(wrap(index - 1, items.length));
  };
  const position = t('guest.gallery.position', { n: index + 1, total: items.length });
  return (
    <dialog
      ref={dialog}
      className="ph-lightbox"
      aria-label={position}
      onClose={onClose}
      onKeyDown={keys}
      data-testid="gallery-lightbox"
    >
      <button type="button" className="ph-lightbox-close ph-btn" onClick={onClose} autoFocus>
        {t('guest.gallery.close')}
      </button>
      {item === undefined ? null : (
        <figure className="ph-lightbox-figure">
          <img src={item.src} alt={item.alt} />
          <figcaption>
            <span>{item.alt}</span>
            <span className="ph-lightbox-count" data-testid="gallery-position">
              {position}
            </span>
          </figcaption>
        </figure>
      )}
      {items.length > 1 ? (
        <div className="ph-lightbox-nav">
          <button
            type="button"
            className="ph-btn"
            onClick={() => onMove(wrap(index - 1, items.length))}
          >
            ← {t('guest.gallery.prev')}
          </button>
          <button
            type="button"
            className="ph-btn"
            onClick={() => onMove(wrap(index + 1, items.length))}
          >
            {t('guest.gallery.next')} →
          </button>
        </div>
      ) : null}
    </dialog>
  );
}

export function GalleryGrid({ items }: { items: readonly GalleryItem[] }): ReactElement | null {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  if (items.length === 0) return null;
  const close = (): void => {
    setOpen(null);
    const back = opener.current;
    if (back !== null) buttons.current[back]?.focus();
  };
  return (
    <>
      <ul className="ph-gallery" data-count={items.length} data-testid="gallery">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              ref={(node) => {
                buttons.current[index] = node;
              }}
              aria-label={t('guest.gallery.open', {
                n: index + 1,
                total: items.length,
                alt: item.alt,
              })}
              onClick={() => {
                opener.current = index;
                setOpen(index);
              }}
            >
              <img src={item.src} alt="" loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      {open === null ? null : (
        <Lightbox items={items} index={open} onMove={setOpen} onClose={close} />
      )}
    </>
  );
}
