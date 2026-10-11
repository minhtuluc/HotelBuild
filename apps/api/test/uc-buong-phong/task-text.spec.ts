import { expect, test } from 'vitest';
import { maskTaskText } from '../../src/modules/fo/housekeeping/task-text.js';
test.each([
  ['Passport B1234567', 'Passport ****4567'],
  ['idNumber AB123456', 'idNumber ****3456'],
  ['Hộ chiếu: C7654321', 'Hộ chiếu: ****4321'],
  ['PASSPORT NO. AB 123 456', 'PASSPORT NO. **** 456'],
  ['id_number=ABCDEFGH', 'id_number=****EFGH'],
  ['CCCD 012345678901', 'CCCD ****8901'],
  ['Passport ABCD', 'Passport ****'],
  ['Passport B1234567; task R1', 'Passport ****4567; task R1'],
  ['Synthetic room R1, 13:00', 'Synthetic room R1, 13:00'],
])('known document/instruction boundary: %s', (input, expected) => {
  expect(maskTaskText(input)).toBe(expected);
});
test('masking is stable on subsequent projection/audit reads', () => {
  const original = 'Passport B1234567; +84912345678; test@example.test';
  const once = maskTaskText(original);
  expect(maskTaskText(once)).toBe(once);
  expect(once).not.toMatch(/B1234567|84912345678|test@example/);
});
