import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
// Catalog chuỗi kéo theo @pinehill/ui-native → react-native; test chỉ đọc khoá nên thay bằng mock rỗng.
vi.mock('react-native', () => ({}));
import { LOGIN_ROUTE, SCREEN_TITLES, START_ROUTE } from '../src/navigation';
import { catalog } from '../src/strings';

// HB-249: trên máy thật header hiện tên route (`index`, `(tabs)`), sau đăng nhập chỉ còn nút Đăng xuất
// và không đường nào vào các tab. Mỗi màn có tiêu đề từ catalog; `/` chuyển thẳng vào tìm phòng.
const appDir = fileURLToPath(new URL('../app', import.meta.url));

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routes(path);
    if (!entry.name.endsWith('.tsx') || entry.name === '_layout.tsx') return [];
    return [relative(appDir, path).replace(/\.tsx$/, '')];
  });
}

test('every screen route has a catalog title so no header shows a file name', () => {
  const missing = routes(appDir).filter((route) => {
    const key = SCREEN_TITLES[route.replace(/^\(tabs\)\//, '')];
    return key === undefined || !(key in catalog);
  });
  expect(missing).toEqual([]);
});

test('the app opens on room search and login is its own route', () => {
  expect(START_ROUTE).toBe('/search');
  expect(LOGIN_ROUTE).toBe('/login');
  const index = readFileSync(join(appDir, 'index.tsx'), 'utf8');
  expect(index).toContain('<Redirect href={START_ROUTE} />');
});

test('screens that need an account send the guest to the login route, not to the start page', () => {
  const prompt = readFileSync(new URL('../src/login-prompt.tsx', import.meta.url), 'utf8');
  expect(prompt).toContain('router.push(LOGIN_ROUTE)');
  for (const file of ['booking/confirm.tsx', '(tabs)/bookings.tsx', '(tabs)/account.tsx']) {
    const source = readFileSync(join(appDir, file), 'utf8');
    expect(source, file).toContain('<LoginPrompt hint=');
    expect(source, file).not.toContain("router.push('/')");
  }
});
