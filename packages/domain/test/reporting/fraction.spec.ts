import { expect, test } from 'vitest';
import { formatFraction } from '../../src/reporting/index.js';

test.each([
  [1n, 3n, 2, false, '0.33'],
  [2n, 3n, 2, false, '0.67'],
  [1n, 3n, 2, true, '33.33'],
  [1n, 8n, 2, false, '0.13'],
  [1999n, 2000n, 2, false, '1.00'],
  [1n, 2n, 0, false, '1'],
  [0n, 3n, 3, true, '0.000'],
  [7n, 2n, 0, true, '350'],
  [1n, 6n, 6, false, '0.166667'],
  [9007199254740991n, 3n, 2, false, '3002399751580330.33'],
] as const)(
  'exact fraction %s/%s, digits=%s percent=%s',
  (numerator, denominator, decimalPlaces, percent, text) => {
    expect(formatFraction({ numerator, denominator }, decimalPlaces, percent)).toEqual({
      ok: true,
      value: {
        text,
        decimalPlaces,
        rounding: 'HALF_UP',
        scale: percent ? 'PERCENT' : 'RATIO',
      },
    });
  },
);
test('null denominator is presented as undefined, default precision is explicit', () => {
  expect(formatFraction(null)).toEqual({
    ok: true,
    value: { text: '—', decimalPlaces: 2, rounding: 'HALF_UP', scale: 'RATIO' },
  });
});
test.each([-1, 7, 1.5, NaN, Infinity])(
  'invalid display precision %s returns an error',
  (digits) => {
    expect(formatFraction({ numerator: 1n, denominator: 3n }, digits)).toMatchObject({
      ok: false,
      error: { code: 'E_REPORT_INVALID_INPUT' },
    });
  },
);
test.each([
  { numerator: -1n, denominator: 1n },
  { numerator: 1n, denominator: 0n },
  { numerator: 1n, denominator: -1n },
])('invalid fraction %#', (fraction) => {
  expect(formatFraction(fraction)).toMatchObject({
    ok: false,
    error: { code: 'E_REPORT_INVALID_INPUT' },
  });
});
test('formatting does not change the exact ratio', () => {
  const fraction = Object.freeze({ numerator: 2n, denominator: 3n });
  formatFraction(fraction, 0, true);
  expect(fraction).toEqual({ numerator: 2n, denominator: 3n });
});
