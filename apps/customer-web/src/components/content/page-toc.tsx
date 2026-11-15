'use client';
/**
 * Mục lục bám cuộn cho trang dài (HB-323, UX-06): dải neo mảnh dính đầu màn, `IntersectionObserver` gắn
 * `aria-current="true"` cho mục đang đọc. Link là neo cùng trang nên không JS vẫn nhảy được; JS chỉ thêm
 * phần đánh dấu. Các đích có `scroll-margin-top` để tiêu đề không nằm dưới dải này.
 */
import { useEffect, useState, type ReactElement } from 'react';

export interface TocItem {
  readonly id: string;
  readonly label: string;
}

/** Mục đang đọc: mục cuối cùng đã cuộn qua vạch đọc; chưa tới mục nào thì `null`. Thuần, để test. */
export function activeTocId(
  tops: readonly { readonly id: string; readonly top: number }[],
  line: number,
): string | null {
  let active: string | null = null;
  for (const item of tops) if (item.top <= line) active = item.id;
  return active;
}

/** Vạch đọc: một phần ba chiều cao màn hình tính từ đỉnh. */
const READ_LINE = 1 / 3;

export function PageToc({
  items,
  label,
}: {
  items: readonly TocItem[];
  label: string;
}): ReactElement {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const targets = items.flatMap((item) => {
      const node = document.getElementById(item.id);
      return node === null ? [] : [{ id: item.id, node }];
    });
    const update = (): void => {
      const tops = targets.map(({ id, node }) => ({ id, top: node.getBoundingClientRect().top }));
      setActive(activeTocId(tops, window.innerHeight * READ_LINE));
    };
    const observer = new IntersectionObserver(update, {
      rootMargin: '0px 0px -60% 0px',
      threshold: [0, 1],
    });
    for (const { node } of targets) observer.observe(node);
    update();
    return () => observer.disconnect();
  }, [items]);
  return (
    <nav className="ph-toc" aria-label={label} data-testid="page-toc">
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} aria-current={active === item.id ? 'true' : undefined}>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
