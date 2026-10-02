import type { Fraction, PricingError } from './index.js';
export class PricingFailure extends Error {
  constructor(
    readonly code: PricingError['code'],
    message: string,
  ) {
    super(message);
  }
}
export function requireValid(condition: boolean, message: string): void {
  if (!condition) throw new PricingFailure('E_RATE_INVALID_INPUT', message);
}
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}
export function rational(n: bigint, d = 1n): Rational {
  requireValid(d > 0n, 'Denominator must be positive');
  let a = n < 0n ? -n : n;
  let b = d;
  while (b !== 0n) {
    const rem = a % b;
    a = b;
    b = rem;
  }
  return { n: n / a, d: d / a };
}
export const ONE: Rational = { n: 1n, d: 1n };
export const ZERO: Rational = { n: 0n, d: 1n };
export function decimal(value: string): Rational {
  requireValid(
    /^\d+(?:\.\d{1,18})?$/.test(value) && value.length <= 40,
    'Expected nonnegative decimal string',
  );
  const [whole, fraction = ''] = value.split('.');
  return rational(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length));
}
export function integer(value: number): Rational {
  requireValid(Number.isSafeInteger(value) && value >= 0, 'Expected nonnegative safe integer');
  return rational(BigInt(value));
}
export function multiply(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}
export function add(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function subtract(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}
export function compare(a: Rational, b: Rational): number {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
export function percent(value: string): Rational {
  const p = decimal(value);
  requireValid(compare(p, integer(100)) <= 0, 'Percentage exceeds 100');
  return multiply(p, rational(1n, 100n));
}
export function fraction(value: Rational): Fraction {
  return { numerator: String(value.n), denominator: String(value.d) };
}
export function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new PricingFailure('E_RATE_UNSAFE_AMOUNT', 'Final amount exceeds safe integer range');
  return Number(value);
}
export function ceil1000(value: Rational): bigint {
  return ((value.n + value.d * 1000n - 1n) / (value.d * 1000n)) * 1000n;
}
export function floor1000(value: Rational): bigint {
  return (value.n / (value.d * 1000n)) * 1000n;
}
