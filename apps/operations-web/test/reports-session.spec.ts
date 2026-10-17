import { afterEach, expect, test } from 'vitest';
import { createReportApi, createPropertyApi, isApiError } from '@pinehill/api-client';
import type { AdrRevparReport, OccupancyReport } from '@pinehill/contracts';
import { readFailureState } from '../src/lib/screen-state';
import { installOpsBrowser, refusedSession, type OpsBrowser } from './session-harness';

/**
 * SCR-52 (màn **báo cáo** công suất & doanh thu) — HB-201 AC4: chưa có phiên thì vòng `load` của
 * `occupancy-report-screen.tsx` (đọc báo cáo + danh mục cơ sở song song) không gửi request nào, xoá dữ
 * liệu đang giữ và chuyển sang trạng thái từ chối.
 */

const RANGE = { from: '2026-12-24', to: '2026-12-27', groupBy: 'DAY' as const };

let browser: OpsBrowser;

afterEach(() => browser.reset());

test('occupancy report screen sends nothing and denies when there is no session', async () => {
  browser = installOpsBrowser(async () => refusedSession());
  const state: { kind: string } = { kind: 'loading' };
  let reports: { occupancy: OccupancyReport; adrRevpar: AdrRevparReport } | null = null;
  const session = browser.open(['/reports', '/properties', '/operations'], () => {
    reports = null;
    state.kind = 'forbidden';
  });
  const api = createReportApi(session.client);

  try {
    const [occupancy, adrRevpar] = await Promise.all([
      api.occupancy(RANGE),
      api.adrRevpar(RANGE),
      createPropertyApi(session.client).list(),
    ]);
    reports = { occupancy: occupancy.data, adrRevpar: adrRevpar.data };
    state.kind = occupancy.data.rows.length === 0 ? 'empty' : 'ready';
  } catch (caught) {
    const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
    if (mapped === undefined) throw caught;
    state.kind = mapped.kind;
  }

  expect(browser.calls).toEqual(['/api/session/refresh']);
  expect(reports).toBeNull();
  expect(state.kind).toBe('forbidden');
});
