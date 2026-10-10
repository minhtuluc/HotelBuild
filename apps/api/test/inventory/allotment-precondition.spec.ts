import { describe, expect, it } from 'vitest';
import { allotmentETag, allotmentExpectedVersion } from '../../src/modules/inv/allotments/scope.js';

function errorFor(input: unknown): unknown {
  try {
    allotmentExpectedVersion(input);
  } catch (error) {
    return error;
  }
  throw new Error('Invalid precondition was accepted');
}

describe('HB035 exact positive bigint configuration token', () => {
  it('accepts strong quoted decimal versions without number precision loss', () => {
    for (const version of [1n, 9007199254740993n, 9223372036854775807n]) {
      expect(allotmentExpectedVersion(allotmentETag(version))).toBe(version);
    }
  });
  it('requires the precondition', () => {
    expect(errorFor(undefined)).toMatchObject({ status: 428, code: 'E_GEN_PRECONDITION_REQUIRED' });
  });
  it.each([
    null,
    1,
    ['"1"'],
    '',
    '*',
    'W/"1"',
    '1',
    '"0"',
    '"01"',
    '"-1"',
    '"1.5"',
    '"1", "2"',
    ' "1" ',
    '"9223372036854775808"',
    '"99999999999999999999"',
  ])('rejects invalid token %j', (input) => {
    expect(errorFor(input)).toMatchObject({ status: 412, code: 'E_GEN_VERSION_CONFLICT' });
  });
});
