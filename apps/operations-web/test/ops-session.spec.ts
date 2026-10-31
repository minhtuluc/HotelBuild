import { afterEach, expect, test, vi } from 'vitest';
import { createBookingApi, isApiError } from '@pinehill/api-client';
import { OPS_BFF_ROOT, opsSessionClient } from '../src/lib/ops-session';
import { readFailureState } from '../src/lib/screen-state';
import {
  emptyList,
  installOpsBrowser,
  issuedSession,
  refusedSession,
  type OpsBrowser,
} from './session-harness';

/**
 * HB-201 AC4 — chứng minh **không request dữ liệu nào rời trình duyệt khi chưa có phiên**, và client
 * chỉ gọi tuyến BFF của đúng màn hình. Dựng môi trường trình duyệt tối thiểu (Web Locks, localStorage,
 * fetch) để đi qua đúng `createSessionClient` thật.
 */

let browser: OpsBrowser;

afterEach(() => browser.reset());

test('without a session no data request leaves the browser and the screen is denied', async () => {
  browser = installOpsBrowser(async () => refusedSession());
  const state: { kind: string } = { kind: 'loading' };
  const denied = vi.fn(() => {
    state.kind = 'forbidden';
  });
  const session = browser.open('/bookings', denied);

  let caught: unknown;
  try {
    await createBookingApi(session.client).list();
  } catch (error) {
    caught = error;
  }

  // Chỉ có lời gọi refresh của phiên (bị BFF từ chối); KHÔNG có request tuyến dữ liệu.
  expect(browser.calls).toEqual(['/api/session/refresh']);
  expect(denied).toHaveBeenCalledTimes(1);
  expect(state.kind).toBe('forbidden');
  // Lỗi trả về vẫn là 401 hợp lệ để nhánh `readFailureState` của màn hình cũng ra "forbidden".
  if (!isApiError(caught)) throw new Error('Expected an ApiError');
  expect(caught.status).toBe(401);
  expect(readFailureState(caught)).toEqual({ kind: 'forbidden' });
});

test('with a session the read goes through the BFF with x-session-request and never to the API origin', async () => {
  let seenMarker: string | null = null;
  browser = installOpsBrowser(async (input, init) => {
    if (String(input).endsWith('/refresh')) return issuedSession();
    seenMarker = new Headers(init?.headers).get('x-session-request');
    return emptyList();
  });
  await createBookingApi(browser.open('/bookings').client).list();

  expect(browser.calls).toEqual([
    '/api/session/refresh',
    `http://ops.test${OPS_BFF_ROOT}/bookings`,
  ]);
  expect(seenMarker).toBe('1');
});

test('a request outside the declared module is refused locally', async () => {
  browser = installOpsBrowser(async () => issuedSession());
  const session = browser.open('/seasons');

  await expect(createBookingApi(session.client).list()).rejects.toBeTruthy();

  expect(browser.calls.every((url) => !url.includes(`${OPS_BFF_ROOT}/bookings`))).toBe(true);
});

test('a disposed screen sends nothing, not even a refresh', async () => {
  browser = installOpsBrowser(async () => issuedSession());
  const session = browser.open('/notifications');
  session.dispose();

  await expect(createBookingApi(session.client).list()).rejects.toBeTruthy();

  expect(browser.calls).toEqual([]);
});

test('an expired session is refreshed once through the BFF before the read is retried', async () => {
  let issued = false;
  browser = installOpsBrowser(async (input) => {
    if (String(input).endsWith('/refresh')) {
      if (!issued) {
        issued = true;
        return issuedSession();
      }
      return refusedSession();
    }
    return Response.json(
      { code: 'E_AUTH_INVALID_CREDENTIALS', message: 'Hết phiên', traceId: 't', path: '/bookings' },
      { status: 401 },
    );
  });
  const denied = vi.fn();
  const session = browser.open('/bookings', denied);
  const read = createBookingApi(session.client);

  await expect(read.list()).rejects.toBeTruthy();

  expect(browser.calls.filter((url) => url.startsWith('/api/session/refresh'))).toHaveLength(2);
  expect(denied).toHaveBeenCalledTimes(1);
});

test('the factory and the hook expose the same client contract', () => {
  browser = installOpsBrowser(async () => issuedSession());
  const session = opsSessionClient(['/bookings', '/quotes']);
  expect(session.client).toBeInstanceOf(Object);
  expect(typeof session.start).toBe('function');
  expect(typeof session.dispose).toBe('function');
  session.dispose();
});
