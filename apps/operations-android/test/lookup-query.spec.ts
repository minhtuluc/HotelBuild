import { expect, test } from 'vitest';
import { parseLookupQuery, searchPlan } from '../src/lookup/query';

test('blank and one-character input never reach the network', () => {
  expect(parseLookupQuery('   ').kind).toBe('empty');
  expect(searchPlan(parseLookupQuery(''))).toEqual({ guests: null, bookings: null });
  expect(parseLookupQuery('a').kind).toBe('invalid');
  expect(searchPlan(parseLookupQuery('a'))).toEqual({ guests: null, bookings: null });
});

test.each([
  ['PH-261101-REP01', 'PH-261101-REP01'],
  ['ph-261101-rep01', 'PH-261101-REP01'],
  ['PH261101REP01', 'PH-261101-REP01'],
  ['PH 261101 K7M2Q', 'PH-261101-K7M2Q'],
  ['ph2611', 'PH-2611'],
])('booking code %s canonicalises to %s', (raw, expected) => {
  const query = parseLookupQuery(raw);
  expect(query.kind).toBe('code');
  expect(query.value).toBe(expected);
  expect(searchPlan(query)).toEqual({ guests: null, bookings: expected });
});

test.each([
  ['0912 345 678', '+84912345678', '+84912345678'],
  ['+84 912 345 678', '+84912345678', '+84912345678'],
  ['84912345678', '+84912345678', '+84912345678'],
  ['0912.345.678', '+84912345678', '+84912345678'],
])('full phone %s becomes %s for both routes', (raw, canonical, bookingTerm) => {
  const query = parseLookupQuery(raw);
  expect(query.kind).toBe('phone');
  expect(query.phone).toBe(canonical);
  expect(searchPlan(query)).toEqual({ guests: canonical, bookings: bookingTerm });
});

test('partial phone drops the local trunk zero for the guest contains-match', () => {
  const partial = parseLookupQuery('0912');
  expect(partial.kind).toBe('phone');
  expect(partial.phone).toBeNull();
  expect(searchPlan(partial)).toEqual({ guests: '+84912', bookings: '0912' });
});

test('name keeps inner single spaces and only queries guest profiles', () => {
  const query = parseLookupQuery('  Nguyễn   Văn An ');
  expect(query.kind).toBe('name');
  expect(query.value).toBe('Nguyễn Văn An');
  expect(searchPlan(query)).toEqual({ guests: 'Nguyễn Văn An', bookings: null });
});

test('email-shaped input stays a guest lookup without leaking into bookings', () => {
  const query = parseLookupQuery('an@example.com');
  expect(query.kind).toBe('name');
  expect(searchPlan(query)).toEqual({ guests: 'an@example.com', bookings: null });
});
