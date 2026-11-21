/** HB-278 — thanh ngữ cảnh như operations web: cơ sở đang làm việc, giờ VN, vai trò; không lộ UUID. */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { ROLE_LABELS, contextRows, vnClock } from '../src/context-bar';

test('giờ VN 24 giờ, không phụ thuộc múi giờ máy', () => {
  expect(vnClock(Date.parse('2026-11-20T05:07:00Z'))).toBe('12:07');
  expect(vnClock(Date.parse('2026-11-20T17:30:00Z'))).toBe('00:30');
});

test('đủ nhãn vai trò bằng tiếng Việt', () => {
  for (const role of [
    'OWNER',
    'MANAGER',
    'FRONT_DESK',
    'RESERVATION_AGENT',
    'ACCOUNTANT',
    'HOUSEKEEPING',
    'SYSADMIN',
  ] as const)
    expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
});

test('chưa có tên cơ sở thì không in id cơ sở', () => {
  const rows = contextRows({
    nowMs: Date.parse('2026-11-20T05:07:00Z'),
    role: 'FRONT_DESK',
    propertyName: null,
  });
  expect(rows.title).toBe('Pine Hill');
  expect(rows.rows).toEqual(['12:07 giờ VN', 'Lễ tân']);
  expect(contextRows({ nowMs: 0, role: 'MANAGER', propertyName: 'Pine Hill Đà Lạt' }).title).toBe(
    'Pine Hill Đà Lạt',
  );
});

test('màn chính hiện bảng ga ngữ cảnh và bảng công việc', () => {
  const home = readFileSync(new URL('../app/home.tsx', import.meta.url), 'utf8');
  expect(home).toContain('<Board title={context.title}>');
  expect(home).toContain("<Board title={t('home.tasksGroup')}>");
});
