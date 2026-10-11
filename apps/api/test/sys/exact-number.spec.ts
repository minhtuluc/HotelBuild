import { test, expect } from 'vitest';
import { exactInteger } from '../../src/modules/sys/settings/exact-number.js';
const cases: readonly [string, bigint | null][] = [
  ['NaN', null],
  ['1.', null],
  ['1000', 1000n],
  ['1000.000', 1000n],
  ['1e3', 1000n],
  ['1.5e1', 15n],
  ['0.0001e4', 1n],
  ['100e-2', 1n],
  ['-1e3', -1000n],
  ['0e999999999999999999', 0n],
  ['1e999999999999999999', null],
  ['1e-999999999999999999', null],
  ['1e-20', null],
  ['1000.00000000000001', null],
  ['9007199254740991.1', null],
  ['9007199254740991', 9007199254740991n],
  ['9007199254740992', null],
  ['-9007199254740991', -9007199254740991n],
  ['-9007199254740992', null],
  ['1e20', null],
  ['1.0000000000000000000e3', 1000n],
];
for (const [value, expected] of cases)
  test(`exact decimal ${value}`, () => expect(exactInteger(value)).toBe(expected));
