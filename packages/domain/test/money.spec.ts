import { expect, test } from 'vitest';
import fc from 'fast-check';
import { Money } from '../src/index.js';

test.each([
  0.5,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER + 1,
  Number.MIN_SAFE_INTEGER - 1,
])('rejects invalid VND %s', (amount) => {
  expect(() => Money.of(amount)).toThrow(RangeError);
});
test.each([0, -100, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])(
  'preserves integer %s',
  (amount) => {
    expect(Money.of(amount).amount).toBe(amount);
    expect(Money.of(amount).currency).toBe('VND');
  },
);
test('arithmetic, comparisons and immutability', () => {
  const money = Money.of(650_000);
  expect(money.add(Money.of(350_000)).amount).toBe(1_000_000);
  expect(money.subtract(Money.of(750_000)).amount).toBe(-100_000);
  expect([
    money.compare(Money.of(1)),
    money.compare(money),
    money.compare(Money.of(700_000)),
  ]).toEqual([1, 0, -1]);
  expect(Object.isFrozen(money)).toBe(true);
  expect(() => Object.assign(money, { amount: 1 })).toThrow(TypeError);
  expect(money.amount).toBe(650_000);
});
test.each([1, -1])('rejects arithmetic overflow in direction %s', (sign) => {
  const boundary = Money.of(sign * Number.MAX_SAFE_INTEGER);
  expect(() => boundary.add(Money.of(sign))).toThrow(RangeError);
  expect(() => boundary.subtract(Money.of(-sign))).toThrow(RangeError);
});
test('integer addition is commutative and subtraction reverses addition', () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (a, b) => {
      const left = Money.of(a),
        right = Money.of(b);
      expect(left.add(right).amount).toBe(right.add(left).amount);
      expect(left.add(right).subtract(right).amount).toBe(a);
      expect(left.subtract(left).amount).toBe(0);
      expect(left.add(right).amount).toBe(a + b);
      expect([left.amount, right.amount]).toEqual([a, b]);
    }),
  );
});
