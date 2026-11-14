/**
 * Locale theo URL (HB-312, quyết định Q2): `/en/...` ghi đè (rewrite) về route hiện có, không dời cây
 * route. Locale và đường dẫn gốc đi vào header cho máy chủ đọc; header cùng tên do trình duyệt gửi luôn bị
 * ghi đè, không tin.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { splitLocale } from './i18n/locales';

const LOCALE_HEADER = 'x-ph-locale';
const PATH_HEADER = 'x-ph-path';

export function middleware(request: NextRequest): NextResponse {
  const { locale, path } = splitLocale(request.nextUrl.pathname);
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  headers.set(PATH_HEADER, path);
  if (path === request.nextUrl.pathname) return NextResponse.next({ request: { headers } });
  const url = request.nextUrl.clone();
  url.pathname = path;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  // Bỏ qua API BFF, nội bộ Next và tệp tĩnh (có phần mở rộng).
  matcher: ['/((?!api|_next|__test|images|fonts|.*\\..*).*)'],
};
