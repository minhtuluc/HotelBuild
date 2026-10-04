/** HB-084: phần thuần điều hướng journey khách — tab, deep link. */
import { describe, expect, it } from 'vitest';
import {
  APP_SCHEME,
  JOURNEY_TABS,
  bookingDeepLink,
  parseDeepLink,
  resolveTab,
} from '../src/navigation';

describe('parseDeepLink', () => {
  it('nhận deep link booking đúng scheme và mã', () => {
    expect(parseDeepLink(`${APP_SCHEME}://booking/PH-260919-K7M2Q`)).toEqual({
      kind: 'booking',
      code: 'PH-260919-K7M2Q',
    });
  });

  it('từ chối scheme lạ và đường dẫn không đúng cấu trúc', () => {
    expect(parseDeepLink('pinehill://booking/ABC')).toEqual({ kind: 'other' });
    expect(parseDeepLink('https://pinehill.vn/booking/ABC')).toEqual({ kind: 'other' });
    expect(parseDeepLink(`${APP_SCHEME}://booking/`)).toEqual({ kind: 'other' });
    expect(parseDeepLink(`${APP_SCHEME}://booking/A/B`)).toEqual({ kind: 'other' });
    expect(parseDeepLink(`${APP_SCHEME}://search`)).toEqual({ kind: 'other' });
  });
});

describe('bookingDeepLink', () => {
  it('dựng deep link mã hoá mã booking', () => {
    expect(bookingDeepLink('PH-260919-K7M2Q')).toBe(`${APP_SCHEME}://booking/PH-260919-K7M2Q`);
  });
});

describe('resolveTab', () => {
  it('nhận tab hợp lệ và về mặc định khi không rõ', () => {
    expect(JOURNEY_TABS).toEqual(['search', 'bookings', 'account']);
    expect(resolveTab('bookings')).toBe('bookings');
    expect(resolveTab('lạ')).toBe('search');
  });
});
