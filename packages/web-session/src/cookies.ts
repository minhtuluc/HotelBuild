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
