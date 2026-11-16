export type SessionKind = 'staff' | 'guest';
const names = { staff: 'pinehill_staff_refresh', guest: 'pinehill_guest_refresh' };
export function sessionCookie(
  kind: SessionKind,
  token: string,
  age: number,
  url: string,
  development = false,
): string {
  const target = new URL(url);
  const secure = !(development && target.protocol === 'http:' && target.hostname === '127.0.0.1');
  return `${names[kind]}=${encodeURIComponent(token)}; Path=/api/session; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
export function readRefreshCookie(kind: SessionKind, header: string | null): string | undefined {
  const entries = (header ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${names[kind]}=`));
  if (entries.length !== 1) return undefined;
  try {
    const value = decodeURIComponent(entries[0]!.slice(names[kind].length + 1));
    return value.length >= 16 && value.length <= 8192 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cookie gợi ý "có thể đã đăng nhập" của khách (HB-324, TD-42): không bí mật, không `HttpOnly`, để trang
 * khách biết có nên gọi `/api/session/refresh` hay không. Khách chưa đăng nhập không có cookie này nên tải
 * trang không phát yêu cầu phiên nào. Quyền truy cập vẫn do máy chủ quyết; nhân viên không dùng gợi ý này.
 */
import { GUEST_SIGNED_HINT } from './hint.js';

export { GUEST_SIGNED_HINT };

export function signedHintCookie(age: number, url: string, development = false): string {
  const target = new URL(url);
  const secure = !(development && target.protocol === 'http:' && target.hostname === '127.0.0.1');
  return `${GUEST_SIGNED_HINT}=${age > 0 ? '1' : ''}; Path=/; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
