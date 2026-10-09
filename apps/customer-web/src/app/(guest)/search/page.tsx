import { Suspense, type ReactElement } from 'react';
import { SearchResultsScreen } from './results-screen';

/** SCR-02 — kết quả tìm phòng (journey khách). Tuyến động vì đọc truy vấn ở thời điểm gọi. */
export const dynamic = 'force-dynamic';

export default function SearchResultsPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <SearchResultsScreen />
    </Suspense>
  );
}
