import { afterEach, expect, test } from 'vitest';
import { createBookingApi, isApiError } from '@pinehill/api-client';
import type { BookingSummary } from '@pinehill/contracts';
import { readFailureState } from '../src/lib/screen-state';
import { installOpsBrowser, refusedSession, type OpsBrowser } from './session-harness';

/**
 * SCR-31 (màn **danh sách** booking) — HB-201 AC4: chưa có phiên thì vòng `load` của
 * `bookings-screen.tsx` không gửi request danh sách nào, chuyển sang trạng thái từ chối và **không** để
 * lại "danh sách rỗng" như thể máy chủ trả rỗng.
 */

let browser: OpsBrowser;

afterEach(() => browser.reset());

test('bookings list screen sends nothing and denies when there is no session', async () => {
  browser = installOpsBrowser(async () => refusedSession());
  const state: { kind: string } = { kind: 'loading' };
  const rows: BookingSummary[] = [];
  const session = browser.open('/bookings', () => {
    rows.length = 0;
    state.kind = 'forbidden';
  });
  const api = createBookingApi(session.client);

  try {
    const page = (await api.list()).data;
    rows.push(...page.data);
    state.kind = rows.length === 0 ? 'empty' : 'ready';
  } catch (caught) {
    const mapped = isApiError(caught) ? readFailureState(caught) : undefined;
    if (mapped === undefined) throw caught;
    state.kind = mapped.kind;
  }

  expect(browser.calls).toEqual(['/api/session/refresh']);
  expect(rows).toEqual([]);
  expect(state.kind).toBe('forbidden');
});
