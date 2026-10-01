/** Integer VND amounts; validate construction and every arithmetic result (BR-GEN-01). */
export class Money {
  readonly currency = 'VND';
  private constructor(readonly amount: number) {
    Object.freeze(this);
  }
  static of(amount: number): Money {
    if (!Number.isSafeInteger(amount)) throw new RangeError('VND must be a safe integer');
    return new Money(amount);
  }
  add(other: Money): Money {
    return Money.of(this.amount + other.amount);
  }
  subtract(other: Money): Money {
    return Money.of(this.amount - other.amount);
  }
  compare(other: Money): -1 | 0 | 1 {
    return this.amount < other.amount ? -1 : this.amount > other.amount ? 1 : 0;
  }
}
