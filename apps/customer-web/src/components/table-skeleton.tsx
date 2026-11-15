/**
 * ANIM-05 — khung chờ đúng hình bảng (HB-316): giữ chỗ cao của bảng sắp hiện để trang không nhảy khi dữ
 * liệu về. Chỉ để nhìn (`aria-hidden`); câu "Đang tải…" của `StateSurface` vẫn báo cho trình đọc màn hình.
 */
import type { ReactElement } from 'react';

export function TableSkeleton({
  active,
  rows,
  columns,
  testId,
}: {
  /** Chỉ hiện khi đang tải; để màn gọi không phải rẽ nhánh. */
  active: boolean;
  rows: number;
  columns: number;
  testId: string;
}): ReactElement | null {
  if (!active) return null;
  return (
    <div className="ph-skeleton" aria-hidden="true" data-testid={testId}>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="ph-skeleton-row"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns }, (__, column) => (
            <span key={column} className="ph-skeleton-bar" />
          ))}
        </div>
      ))}
    </div>
  );
}
