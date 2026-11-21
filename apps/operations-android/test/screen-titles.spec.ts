import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
// Catalog kéo theo @pinehill/ui-native → react-native; test chỉ đọc chuỗi nên thay bằng mock rỗng.
vi.mock('react-native', () => ({}));
import { ROUTE_TITLES, STAGES, backStep, stageTitle } from '../src/stages';

// HB-252: trên máy thật mọi màn của app vận hành có header "index" (tên file route), và nút Back
// của Android thoát hẳn app thay vì về màn chính, vì cả luồng chạy trong một route bằng state.
const appDir = fileURLToPath(new URL('../app', import.meta.url));

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routes(path);
    if (!entry.name.endsWith('.tsx') || entry.name === '_layout.tsx') return [];
    return [relative(appDir, path).replace(/\.tsx$/, '')];
  });
}

test('every route file has a readable header title, never its file name', () => {
  const bad = routes(appDir).filter((route) => {
    const title = ROUTE_TITLES[route];
    return title === undefined || title === '' || title === route;
  });
  expect(bad).toEqual([]);
});

test('every stage of the index flow has its own header title', () => {
  const titles = STAGES.map(stageTitle);
  expect(titles.every((title) => title !== '' && title !== 'index')).toBe(true);
  expect(stageTitle('arrivals')).not.toBe(stageTitle('home'));
  expect(stageTitle('departures')).not.toBe(stageTitle('arrivals'));
});

test('the root layout and the index flow both set titles from these tables', () => {
  const layout = readFileSync(join(appDir, '_layout.tsx'), 'utf8');
  expect(layout).toContain('ROUTE_TITLES');
  const index = readFileSync(join(appDir, 'index.tsx'), 'utf8');
  expect(index).toContain('<Stack.Screen options={{ title: stageTitle(stage) }} />');
  expect(index).toContain("BackHandler.addEventListener('hardwareBackPress'");
});

const idle = {
  stage: 'home',
  noShow: false,
  collecting: false,
  walkInFromArrivals: false,
} as const;

test('Android back closes the open sub-screen first, then returns a tool to home', () => {
  expect(backStep({ ...idle, stage: 'arrivals', noShow: true, collecting: true })).toBe(
    'closeNoShow',
  );
  expect(backStep({ ...idle, stage: 'arrivals', collecting: true })).toBe('closeCollect');
  expect(backStep({ ...idle, stage: 'arrivals', walkInFromArrivals: true })).toBe('closeWalkIn');
  for (const stage of ['housekeeping', 'lookup', 'arrivals', 'walkIn', 'departures'] as const) {
    expect(backStep({ ...idle, stage }), stage).toBe('home');
  }
});

test('on home and on the sign-in steps Android back keeps its default (leave the app)', () => {
  for (const stage of [
    'boot',
    'login',
    'changePassword',
    'pinSetup',
    'selectProperty',
    'home',
  ] as const) {
    expect(backStep({ ...idle, stage }), stage).toBe('default');
  }
});

test('HB-274: header bảng ga đen ⇒ chữ thanh trạng thái sáng; font thương hiệu nạp trước khi vẽ', () => {
  const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  expect(layout).toContain("useStatusBarStyle('light-content');");
  expect(layout).toContain('useBrandFonts()');
});

test('HB-274: theme của app là theme vận hành dùng chung, không tự định nghĩa lại', () => {
  const source = readFileSync(new URL('../src/theme.ts', import.meta.url), 'utf8');
  expect(source).toContain("createTheme('ops')");
  expect(source).not.toContain('backgroundColor');
});
