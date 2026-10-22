import { expect, test } from 'vitest';
import { loginUrl, safeNextPath } from '../../src/session/next-path';

test.each(['/bookings', '/bookings/b1/collect?x=1#top', '/front-desk?date=2026-12-24', '/'])(
  'internal path %s is kept',
  (path) => {
    expect(safeNextPath(path)).toBe(path);
  },
);

test.each([
  ['//evil.example', 'protocol-relative'],
  ['/\\evil.example', 'backslash after slash'],
  ['https://evil.example/x', 'absolute URL'],
  ['javascript:alert(1)', 'script scheme'],
  ['bookings', 'relative path'],
  ['/ok\nSet-Cookie: x=1', 'control characters'],
  ['/ok\t/evil', 'tab'],
  ['/' + 'a'.repeat(600), 'over-long'],
  ['', 'empty'],
])('unsafe next %s (%s) falls back to /', (raw) => {
  expect(safeNextPath(raw)).toBe('/');
});

test.each([null, undefined])('missing next (%s) falls back', (raw) => {
  expect(safeNextPath(raw)).toBe('/');
  expect(safeNextPath(raw, '/day-board')).toBe('/day-board');
});

test('auth surfaces never become a redirect target (no login loop)', () => {
  for (const path of ['/login', '/login?next=%2Fx', '/change-password', '/select-property'])
    expect(safeNextPath(path)).toBe('/');
});

test('loginUrl encodes next, drops unsafe next and carries the reason', () => {
  expect(loginUrl('/bookings?a=1')).toBe('/login?next=%2Fbookings%3Fa%3D1');
  expect(loginUrl('/')).toBe('/login');
  expect(loginUrl('//evil.example')).toBe('/login');
  expect(loginUrl('/bookings', 'expired')).toBe('/login?next=%2Fbookings&reason=expired');
  expect(loginUrl('/', 'expired')).toBe('/login?reason=expired');
});
