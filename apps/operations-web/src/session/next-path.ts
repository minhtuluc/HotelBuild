/**
 * `next` của `/login?next=…` chỉ được là **đường dẫn nội bộ** (chống open redirect, ticket HB-020 AC4).
 * Hàm thuần: nhận chuỗi thô từ URL, trả đường dẫn an toàn hoặc `fallback`.
 */
const MAX_LENGTH = 512;
const CONTROL = /[\u0000-\u001f\u007f]/;
const AUTH_SURFACES = ['/login', '/change-password', '/select-property'];

export type LoginReason = 'expired';

export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  if (CONTROL.test(raw)) return fallback;
  const path = raw.split(/[?#]/)[0]!;
  if (AUTH_SURFACES.some((surface) => path === surface || path.startsWith(`${surface}/`)))
    return fallback;
  return raw;
}

/** `/login` kèm `next` (đã lọc) và lý do nếu có; `next` là `/` thì bỏ cho gọn. */
export function loginUrl(next: string, reason?: LoginReason): string {
  const safe = safeNextPath(next);
  const params = new URLSearchParams();
  if (safe !== '/') params.set('next', safe);
  if (reason !== undefined) params.set('reason', reason);
  const query = params.toString();
  return query === '' ? '/login' : `/login?${query}`;
}

/** Đích sau khi qua cổng phụ (`/change-password`, `/select-property`) kèm `next` đã lọc. */
export function gateUrl(surface: '/change-password' | '/select-property', next: string): string {
  const safe = safeNextPath(next);
  return safe === '/' ? surface : `${surface}?next=${encodeURIComponent(safe)}`;
}
