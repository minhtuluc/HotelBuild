/**
 * Menu nhân viên ↔ màn có thật (HB-328, TD-43): mọi mục menu trỏ tới một `page.tsx` tồn tại, và mọi màn
 * không có tham số động đều có đường vào từ menu. Trước HB-328 có bảy màn "mồ côi": SCR-15 `/admin/users`,
 * SCR-39 `/reconciliation`, SCR-33/34 `/bookings/new`, SCR-40/41/42 `/channels/*`, SCR-47.
 * Màn cần mã ngữ cảnh trên URL thì khai trong `REACHED_FROM_PARENT`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPS_NAV_GROUPS, currentNavHref } from '../src/session/ops-nav';

const OPS_DIR = fileURLToPath(new URL('../src/app/(ops)/', import.meta.url));

/** Màn mở từ màn cha hoặc từ lỗi/điều hướng, không cần mục menu riêng. */
const REACHED_FROM_PARENT = new Set([
  '/access-denied',
  '/states',
  // Cần mã ngữ cảnh trên URL (`caseId`; `mergeId`/`moveId`), vào từ bảng quá tải chứ không từ menu (TD-84).
  '/overbooking/merge-walkout',
  '/overbooking/relocation',
]);

function pageRoutes(dir: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) routes.push(...pageRoutes(path));
    else if (entry === 'page.tsx') {
      const rel = relative(OPS_DIR, dir).split(sep).join('/');
      routes.push(rel === '' ? '/' : `/${rel}`);
    }
  }
  return routes;
}

const navHrefs = OPS_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

describe('menu nhân viên', () => {
  it('mọi mục menu trỏ tới màn có thật', () => {
    for (const href of navHrefs) {
      const file = join(OPS_DIR, href === '/' ? '' : href.slice(1), 'page.tsx');
      expect(existsSync(file), href).toBe(true);
    }
  });

  it('không có mục trùng', () => {
    expect(new Set(navHrefs).size).toBe(navHrefs.length);
  });

  it('mọi màn cấp đầu đều có đường vào từ menu', () => {
    const orphans = pageRoutes(OPS_DIR)
      .filter((route) => !route.includes('['))
      .filter((route) => !navHrefs.includes(route) && !REACHED_FROM_PARENT.has(route));
    expect(orphans).toEqual([]);
  });

  it('có mục cho các màn trước đây không có đường vào', () => {
    expect(navHrefs).toEqual(
      expect.arrayContaining([
        '/admin/users',
        '/reconciliation',
        '/bookings/new',
        '/channels/configuration',
        '/channels/sync',
        '/channels/ota-bookings',
        '/overbooking/policy-exceptions',
      ]),
    );
  });
});

describe('mục đang mở', () => {
  it('chỉ đánh dấu mục khớp dài nhất', () => {
    expect(currentNavHref('/bookings/new')).toBe('/bookings/new');
    expect(currentNavHref('/bookings/abc/cancel')).toBe('/bookings');
    expect(currentNavHref('/channels/sync')).toBe('/channels/sync');
    expect(currentNavHref('/channels')).toBe('/channels');
    expect(currentNavHref('/')).toBe('/');
    expect(currentNavHref('/overbooking/relocation')).toBeNull();
  });
});
