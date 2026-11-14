'use client';
/**
 * Dòng ngày đầy đủ in ngay dưới `<input type="date">` (HB-309, quyết định Q6 của kế hoạch giao diện).
 *
 * Ô ngày gốc giữ nguyên (bàn phím, trình đọc màn hình, bộ chọn ngày của điện thoại đều dùng tốt) nhưng trình
 * duyệt có thể hiện `mm/dd/yyyy`. Dòng này in ngày theo locale của trang (vd. "T5, 24/12/2026") để khách
 * không phải đoán; ô nối tới dòng qua `aria-describedby={id}`. Chưa chọn ngày thì để trống, giữ chỗ cao.
 *
 * Dòng nằm trong `<label>` của ô nên đặt `aria-hidden`: tên đọc của ô giữ nguyên ("Nhận phòng"), còn ngày
 * được đọc như mô tả (phần tử được `aria-describedby` trỏ thẳng tới vẫn tính, dù ẩn khỏi cây truy cập).
 */
import type { ReactElement } from 'react';
import { useLocale } from '../i18n/client';
import { dateLine } from '../i18n/format';

export function DateLine({ id, iso }: { id: string; iso: string }): ReactElement {
  const locale = useLocale();
  return (
    <span id={id} className="ph-date-line" data-testid={id} aria-hidden="true">
      {dateLine(iso, locale) ?? ''}
    </span>
  );
}
