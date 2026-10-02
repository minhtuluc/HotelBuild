import {
  add,
  compare,
  decimal,
  integer,
  multiply,
  percent,
  PricingFailure,
  subtract,
  ZERO,
} from './arithmetic.js';
import type { Rational } from './arithmetic.js';
import type { PricingInput, PricingWarning } from './index.js';
import { lexical } from './resolution.js';
export function promotions(
  i: PricingInput,
  subtotal: Rational,
  floor: Rational,
): { discount: Rational; codes: string[]; warnings: PricingWarning[] } {
  const selected = [...i.promotions].sort(
    (a, b) =>
      Number(a.kind === 'PERCENT') - Number(b.kind === 'PERCENT') || lexical(a.code, b.code),
  );
  if (
    selected.length > 2 ||
    (selected.length === 2 && selected.some((p) => !p.stackable)) ||
    selected.some(
      (p) =>
        i.now < p.validFrom ||
        i.now >= p.validTo ||
        (p.maxUses !== undefined && p.uses >= p.maxUses),
    )
  )
    throw new PricingFailure(
      'E_RATE_PROMOTION_INVALID',
      'Promotion expired, exhausted or cannot stack',
    );
  let amount = ZERO,
    percentage = ZERO;
  for (const p of selected) {
    if (p.kind === 'AMOUNT') amount = add(amount, decimal(p.value));
    else percentage = add(percentage, percent(p.value));
  }
  // Two percentage codes add, while percentages use the subtotal remaining after AMOUNT.
  const remainder = subtract(subtotal, amount);
  let discount = add(amount, multiply(compare(remainder, ZERO) < 0 ? ZERO : remainder, percentage));
  const cap = multiply(subtotal, percent(i.settings.maxDiscountPercent));
  const warnings: PricingWarning[] = [];
  if (compare(discount, cap) > 0) {
    discount = cap;
    warnings.push('E_RATE_DISCOUNT_CAPPED');
  }
  if (compare(subtract(subtotal, discount), floor) < 0) {
    warnings.push('E_RATE_BELOW_FLOOR');
    return { discount: integer(0), codes: [], warnings };
  }
  return { discount, codes: selected.map((p) => p.code), warnings };
}
