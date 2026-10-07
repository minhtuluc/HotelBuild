import { expect, test } from 'vitest';
import { isPublicSession, isSessionState } from '../src/protocol.js';
import { readRefreshCookie } from '../src/cookies.js';
const valid = {
  accessToken: 'synthetic-access-token-0001',
  expiresInSeconds: 900,
  mustChangePassword: false,
};
test.each([
  null,
  [],
  1,
  {},
  { ...valid, accessToken: 1 },
  { ...valid, accessToken: 'short' },
  { ...valid, expiresInSeconds: 0 },
  { ...valid, expiresInSeconds: 1.5 },
  { ...valid, expiresInSeconds: '900' },
  { ...valid, mustChangePassword: 'false' },
])('rejects invalid public session %#', (value) => {
  expect(isPublicSession(value)).toBe(false);
  expect(isSessionState(value)).toBe(false);
});
test.each([undefined, 'bad', NaN, Infinity])('rejects invalid state expiry %#', (expiresAt) => {
  expect(isSessionState({ ...valid, expiresAt })).toBe(false);
});
test('state validates valid expiry', () => {
  expect(isSessionState({ ...valid, expiresAt: 10000 })).toBe(true);
});
test.each([
  null,
  'pinehill_staff_refresh=%XX',
  'pinehill_staff_refresh=short',
  'pinehill_staff_refresh=synthetic-token-0001; pinehill_staff_refresh=synthetic-token-0002',
  `pinehill_staff_refresh=${'x'.repeat(8193)}`,
])('ambiguous or malformed cookies cannot become refresh sources %#', (header) => {
  expect(readRefreshCookie('staff', header)).toBeUndefined();
});
