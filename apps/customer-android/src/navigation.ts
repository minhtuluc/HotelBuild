/**
 * Điều hướng journey khách (SCR-72) — phần thuần, kiểm được trên Node không cần UI.
 * Deep link theo scheme thật của app (`app.json` → `pinehill-customer://booking/<code>`);
 * đặc tả HB-084 ghi `pinehill://` chỉ là minh hoạ — dùng scheme thật để không vỡ universal link.
 */
import type { catalog } from './strings';

export const APP_SCHEME = 'pinehill-customer';

/** Các tab chính của journey khách: tìm phòng / đơn của tôi / tài khoản. */
export const JOURNEY_TABS = ['search', 'bookings', 'account'] as const;

export type JourneyTab = (typeof JOURNEY_TABS)[number];

export type DeepLink = { kind: 'booking'; code: string } | { kind: 'other' };

/** Phân tích deep link `pinehill-customer://booking/<code>`; mọi thứ khác → `{ kind: 'other' }`. */
export function parseDeepLink(url: string): DeepLink {
  const prefix = `${APP_SCHEME}://`;
  if (!url.startsWith(prefix)) return { kind: 'other' };
  const segments = url
    .slice(prefix.length)
    .split('/')
    .filter((segment) => segment !== '');
  if (segments.length === 2 && segments[0] === 'booking') {
    return { kind: 'booking', code: segments[1] ?? '' };
  }
  return { kind: 'other' };
}

/** Dựng deep link mở chi tiết booking theo mã. */
export function bookingDeepLink(code: string): string {
  return `${APP_SCHEME}://booking/${encodeURIComponent(code)}`;
}

/** Nhận diện tab hợp lệ; giá trị không rõ thì về tab mặc định (tìm phòng). */
export function resolveTab(value: string): JourneyTab {
  for (const tab of JOURNEY_TABS) {
    if (tab === value) return tab;
  }
  return 'search';
}

/** HB-249: app mở thẳng vào tìm phòng (xem phòng không cần tài khoản); đăng nhập là một màn riêng. */
export const START_ROUTE = '/search';
export const LOGIN_ROUTE = '/login';

/**
 * Tiêu đề header của từng route (khoá catalog), để header không hiện tên file như `index` hay `(tabs)`.
 * Route trong nhóm `(tabs)` ghi không kèm tên nhóm.
 */
export const SCREEN_TITLES: Readonly<Record<string, keyof typeof catalog>> = {
  index: 'home.title',
  login: 'guest.title',
  search: 'journey.search.title',
  bookings: 'journey.bookings.title',
  account: 'journey.account.title',
  'room/[roomTypeId]': 'screen.room',
  'booking/confirm': 'hold.title',
  'booking/[code]': 'orders.detail.title',
  'booking/[code]/cancel': 'booking.cancel.title',
  'booking/[code]/reschedule': 'booking.reschedule.title',
  'payment/[bookingId]': 'screen.payment',
  'access-denied': 'screen.accessDenied',
  '+not-found': 'screen.notFound',
};
