'use client';
/**
 * Liên kết hai chiều hình ↔ danh sách (HB-323, UX-02), kiểu tăng cường dần: phần tử máy chủ đã dựng mang
 * `data-sync="<nhóm>"` và `data-code="<mã>"`. Rê chuột hoặc focus vào một phần tử thì mọi phần tử cùng nhóm,
 * cùng mã được gắn `data-sync-active` để CSS nổi viền. Không JS thì trang vẫn đủ, chỉ thiếu phần nổi viền.
 */
import { useEffect } from 'react';

/** Gắn/bỏ đánh dấu cho cả nhóm theo mã; `null` là bỏ hết. Dùng chung với mặt cắt khoang. */
export function markSync(group: string, code: string | null, root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>(`[data-sync="${group}"]`)) {
    if (code !== null && node.dataset.code === code) node.dataset.syncActive = 'true';
    else delete node.dataset.syncActive;
  }
}

export function SyncHighlight({ group }: { group: string }): null {
  useEffect(() => {
    const targetOf = (event: Event): HTMLElement | null =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(`[data-sync="${group}"]`)
        : null;
    const enter = (event: Event): void => {
      const target = targetOf(event);
      if (target?.dataset.code !== undefined) markSync(group, target.dataset.code);
    };
    const leave = (event: Event): void => {
      if (targetOf(event) !== null) markSync(group, null);
    };
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', enter);
    document.addEventListener('focusout', leave);
    return () => {
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('focusout', leave);
    };
  }, [group]);
  return null;
}
