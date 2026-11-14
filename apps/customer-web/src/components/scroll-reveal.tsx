'use client';
/**
 * ANIM-04 — trượt nhẹ khi cuộn tới, "an toàn SSR" (HB-316, DESIGN.md › Motion).
 *
 * HTML máy chủ không ẩn gì: mọi `[data-reveal]` hiện đầy đủ khi chưa có JS hoặc JS chậm. Sau khi chạy, chỉ
 * phần tử **đang nằm dưới màn hình** mới được gắn `ph-reveal-pending`, rồi trượt lên một lần khi cuộn tới
 * và thôi theo dõi. Phần tử đã ở trong màn đầu (vùng LCP) không bao giờ bị ẩn. Người dùng bật giảm chuyển
 * động hoặc trình duyệt thiếu `IntersectionObserver` thì không làm gì.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const PENDING = 'ph-reveal-pending';
const SHOWN = 'ph-reveal-in';

export function ScrollReveal(): null {
  const pathname = usePathname();
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.remove(PENDING);
          entry.target.classList.add(SHOWN);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08 },
    );
    const fold = window.innerHeight;
    for (const node of document.querySelectorAll('[data-reveal]')) {
      if (node.classList.contains(SHOWN) || node.getBoundingClientRect().top < fold) continue;
      node.classList.add(PENDING);
      observer.observe(node);
    }
    return () => {
      observer.disconnect();
      for (const node of document.querySelectorAll(`.${PENDING}`)) node.classList.remove(PENDING);
    };
  }, [pathname]);
  return null;
}
