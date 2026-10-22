import { expect, test } from 'vitest';
import type { UserMe } from '@pinehill/contracts';
import { decideGate, grantedProperties } from '../../src/session/gate';

const me = (over: Partial<UserMe> = {}): UserMe => ({
  userId: 'u1',
  username: 'letan01',
  fullName: 'Lễ tân',
  role: 'FRONT_DESK',
  propertyScope: ['p1'],
  hasPin: true,
  mustChangePassword: false,
  ...over,
});
const props = (...ids: string[]) => ids.map((id) => ({ id, name: `CS ${id}` }));

test('no profile (no session) sends every stage to login', () => {
  for (const stage of ['app', 'change-password', 'select-property'] as const)
    expect(decideGate({ stage, me: null, properties: null, stored: null })).toEqual({
      kind: 'redirect',
      to: 'login',
    });
});

test('must-change-password blocks the app and the property chooser until changed', () => {
  const profile = me({ mustChangePassword: true });
  expect(decideGate({ stage: 'app', me: profile, properties: props('p1'), stored: null })).toEqual({
    kind: 'redirect',
    to: 'change-password',
  });
  expect(
    decideGate({ stage: 'select-property', me: profile, properties: props('p1'), stored: null }),
  ).toEqual({ kind: 'redirect', to: 'change-password' });
  expect(
    decideGate({ stage: 'change-password', me: profile, properties: null, stored: null }),
  ).toEqual({ kind: 'ready', propertyId: null });
});

test('one-property staff enter the app directly with that property', () => {
  expect(decideGate({ stage: 'app', me: me(), properties: props('p1'), stored: null })).toEqual({
    kind: 'ready',
    propertyId: 'p1',
  });
});

test('multi-property staff and OWNER are sent to choose; a restored choice goes straight in', () => {
  const many = me({ role: 'MANAGER', propertyScope: ['p1', 'p2'] });
  expect(
    decideGate({ stage: 'app', me: many, properties: props('p1', 'p2'), stored: null }),
  ).toEqual({
    kind: 'redirect',
    to: 'select-property',
  });
  expect(
    decideGate({ stage: 'app', me: many, properties: props('p1', 'p2'), stored: 'p2' }),
  ).toEqual({
    kind: 'ready',
    propertyId: 'p2',
  });
  const owner = me({ role: 'OWNER', propertyScope: [] });
  expect(
    decideGate({ stage: 'app', me: owner, properties: props('p1', 'p2'), stored: null }),
  ).toEqual({
    kind: 'redirect',
    to: 'select-property',
  });
});

test('an OWNER with a single property enters directly: nothing to choose', () => {
  const owner = me({ role: 'OWNER', propertyScope: [] });
  expect(decideGate({ stage: 'app', me: owner, properties: props('p1'), stored: null })).toEqual({
    kind: 'ready',
    propertyId: 'p1',
  });
});

test('when the property list could not be loaded the server scope is used (names fall back to ids)', () => {
  const staff = me({ role: 'OWNER', propertyScope: ['p1', 'p2'] });
  expect(decideGate({ stage: 'app', me: staff, properties: null, stored: 'p2' })).toEqual({
    kind: 'ready',
    propertyId: 'p2',
  });
  expect(grantedProperties(staff, null)).toEqual([
    { id: 'p1', name: 'p1' },
    { id: 'p2', name: 'p2' },
  ]);
});

test('the grant list is the server scope; properties outside it are never offered (non-OWNER)', () => {
  const staff = me({ role: 'MANAGER', propertyScope: ['p1'] });
  expect(
    decideGate({ stage: 'app', me: staff, properties: props('p1', 'p2', 'p3'), stored: 'p3' }),
  ).toEqual({ kind: 'ready', propertyId: 'p1' });
});

test('the chooser stage stays on the chooser and reports its options; nothing granted is "none"', () => {
  const many = me({ role: 'MANAGER', propertyScope: ['p1', 'p2'] });
  expect(
    decideGate({ stage: 'select-property', me: many, properties: props('p1', 'p2'), stored: null }),
  ).toEqual({ kind: 'ready', propertyId: null });
  expect(
    decideGate({
      stage: 'app',
      me: me({ propertyScope: [] }),
      properties: props('p1'),
      stored: null,
    }),
  ).toEqual({ kind: 'none' });
});
