'use client';
/**
 * Bộ lọc có `propertyId` đi theo cơ sở đang làm việc (TD-44, HB-314): khi người dùng đổi cơ sở trên thanh
 * ngữ cảnh, đặt lại `propertyId` của các bộ lọc (bản nháp và bản đã áp) về cơ sở mới. Lần đầu không làm gì:
 * màn tự khởi tạo bộ lọc bằng cơ sở đang làm việc để không tải hai lần.
 *
 * `available` (HB-320): danh sách cơ sở máy chủ trả cho màn; có thì cơ sở đang làm việc ngoài danh sách
 * bị bỏ qua (giữ nguyên lựa chọn hiện tại).
 */
import { useEffect, useRef } from 'react';

type Setter<T> = (update: (current: T) => T) => void;

export function useFollowWorkingProperty<T extends { readonly propertyId: string }>(
  working: string,
  setters: readonly Setter<T>[],
  available?: readonly { readonly id: string }[],
): void {
  const previous = useRef(working);
  const listed = useRef(available);
  listed.current = available;
  useEffect(() => {
    if (previous.current === working) return;
    previous.current = working;
    const list = listed.current;
    if (list !== undefined && !list.some((item) => item.id === working)) return;
    for (const set of setters) {
      set((current) =>
        current.propertyId === working ? current : { ...current, propertyId: working },
      );
    }
  }, [working, setters]);
}
