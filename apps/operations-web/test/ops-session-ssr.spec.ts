import { afterEach, expect, test, vi } from 'vitest';
import { createElement, type ComponentType, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBookingApi } from '@pinehill/api-client';
import { OPS_BFF_ROOT, opsSessionClient, useOpsSession } from '../src/lib/ops-session';
import { ChannelsScreen } from '../src/app/(ops)/channels/channels-screen';
import { OccupancyReportScreen } from '../src/app/(ops)/reports/occupancy/occupancy-report-screen';
import { SeasonsScreen } from '../src/app/(ops)/seasons/seasons-screen';
import { emptyList, installOpsBrowser, issuedSession, type OpsBrowser } from './session-harness';

/**
 * HB-201 — an toàn SSR: `page.tsx` của màn `(ops)` là server component nên Next **render trên server**
 * mọi client component của màn hình. Lượt render đó không được chạm `window` (không có trong node) và
 * cũng không được phát request nào.
 *
 * `window`/`localStorage`/`BroadcastChannel`/`navigator` được gỡ hẳn khỏi global trước mỗi ca, nên bất
 * kỳ lời gọi nào lúc render cũng ném và ca đỏ ngay — đó là điều cần chứng minh.
 *
 * Ca client-side chạy đúng baseUrl BFF được chứng minh ở biên nhà máy — chính đối tượng
 * `useOpsSession` trả về ở trình duyệt (môi trường test này không có DOM nên không chạy được effect).
 */
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  useParams: () => ({}),
  usePathname: () => '/',
}));

let browser: OpsBrowser;

afterEach(() => {
  browser?.reset();
  vi.unstubAllGlobals();
});

/** Gỡ mọi global chỉ có ở trình duyệt: bất kỳ truy cập nào lúc render sẽ ném. */
function serverGlobals(): void {
  vi.stubGlobal('window', undefined);
  vi.stubGlobal('localStorage', undefined);
  vi.stubGlobal('sessionStorage', undefined);
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('navigator', undefined);
}

function Screen(): ReactElement {
  const session = useOpsSession('/bookings');
  return createElement(
    'span',
    { 'data-testid': 'ops-session' },
    typeof session.client === 'object' ? 'ready' : 'broken',
  );
}

const WIRED_SCREENS: readonly [string, ComponentType][] = [
  ['màn danh sách kênh', ChannelsScreen],
  ['màn mùa & hệ số', SeasonsScreen],
  ['màn báo cáo công suất', OccupancyReportScreen],
];

test('a real wired screen renders on the server with no browser globals and sends nothing', () => {
  serverGlobals();
  const network = vi.fn();
  vi.stubGlobal('fetch', network);

  for (const [label, Screen] of WIRED_SCREENS) {
    expect(() => renderToStaticMarkup(createElement(Screen)), label).not.toThrow();
  }
  expect(network).not.toHaveBeenCalled();
});

test('server render of the shared factory needs no window and sends nothing', () => {
  serverGlobals();
  const network = vi.fn();
  vi.stubGlobal('fetch', network);

  expect(renderToStaticMarkup(createElement(Screen))).toContain('ready');
  expect(network).not.toHaveBeenCalled();
});

test('the browser build of the same factory targets the BFF origin', async () => {
  browser = installOpsBrowser(async (input) =>
    String(input).endsWith('/refresh') ? issuedSession() : emptyList(),
  );
  const session = browser.open('/bookings');
  await createBookingApi(session.client).list();

  expect(browser.calls).toEqual([
    '/api/session/refresh',
    `http://ops.test${OPS_BFF_ROOT}/bookings`,
  ]);
});

test('the factory is constructible with no browser globals at all', () => {
  vi.stubGlobal('window', undefined);
  const session = opsSessionClient('/bookings');
  expect(typeof session.start).toBe('function');
  session.dispose();
});
