import {
  ceil1000,
  compare,
  decimal,
  fraction,
  integer,
  multiply,
  ONE,
  percent,
  rational,
  safe,
  subtract,
} from './arithmetic.js';
import type { Rational } from './arithmetic.js';
import { baseRate, channel, occupancy, season } from './resolution.js';
import { dateDay } from './validation.js';
import type { NightPrice, PricingInput, PricingWarning } from './index.js';
function clamp(p: Rational, min: Rational, max: Rational): Rational {
  return compare(p, min) < 0 ? min : compare(p, max) > 0 ? max : p;
}
function bounds(i: PricingInput, p: Rational) {
  return clamp(p, integer(i.room.minPrice), integer(i.room.maxPrice));
}
function weekendMultiplier(i: PricingInput, date: string, enabled: boolean | undefined): Rational {
  const weekday = (((dateDay(date) + 4) % 7) + 7) % 7;
  return enabled === true && (weekday === 5 || weekday === 6)
    ? decimal(i.settings.weekendMultiplier)
    : ONE;
}
function calculate(i: PricingInput, date: string, los: Rational) {
  const resolvedBase = baseRate(i, date),
    s = season(i, date),
    o = occupancy(i, date),
    c = channel(i, date);
  const base = integer(resolvedBase.price),
    p1 = multiply(base, s ? decimal(s.multiplier) : ONE),
    p2 = multiply(p1, weekendMultiplier(i, date, s?.weekendSurchargeEnabled)),
    p3 = multiply(p2, o.multiplier),
    p4 = multiply(p3, los),
    p5 = multiply(p4, decimal(c.value.multiplier)),
    p6 = bounds(i, p5);
  return { resolvedBase, s, o, c, base, p1, p2, p3, p4, p5, p6 };
}
function priceWarnings(
  i: PricingInput,
  date: string,
  los: Rational,
  p6: Rational,
): PricingWarning[] {
  const warnings: PricingWarning[] = [];
  if (i.channelCode.startsWith('OTA_') && i.channels.some((x) => x.code === 'WEB')) {
    const web = calculate({ ...i, channelCode: 'WEB' }, date, los),
      c = channel(i, date);
    if (
      compare(
        multiply(p6, subtract(ONE, percent(c.value.commissionPercent))),
        multiply(web.p6, subtract(ONE, percent(web.c.value.commissionPercent))),
      ) < 0
    )
      warnings.push('E_RATE_CHANNEL_PARITY');
  }
  const c = channel(i, date);
  if (
    ['WEB', 'PHONE', 'WALKIN'].includes(i.channelCode) &&
    compare(decimal(c.value.multiplier), ONE) < 0
  )
    warnings.push('E_RATE_DIRECT_BELOW_BASE');
  return warnings;
}
export function losMultiplier(i: PricingInput, count: number): Rational {
  if (!i.ratePlan.losDiscountEnabled) return ONE;
  const los = [...i.settings.los]
    .sort((a, b) => b.minNights - a.minNights)
    .find((l) => count >= l.minNights);
  return los ? decimal(los.multiplier) : ONE;
}
export function nightly(
  i: PricingInput,
  date: string,
  los: Rational,
): { night: NightPrice; warnings: PricingWarning[] } {
  const { resolvedBase, s, o, c, base, p1, p2, p3, p4, p5, p6 } = calculate(i, date, los);
  const price = ceil1000(p6),
    values = [base, p1, p2, p3, p4, p5, p6, rational(price)];
  const warnings = priceWarnings(i, date, los, p6);
  if (o.zeroDemandSupply) warnings.push('E_RATE_ZERO_SUPPLY');
  return {
    warnings,
    night: {
      date,
      baseSource: resolvedBase.source,
      calendarId: resolvedBase.id,
      seasonId: s?.id ?? null,
      occupancySnapshotId: o.id,
      occupancyCapturedAt: o.capturedAt,
      channelSettingId: c.id,
      commissionPercent: fraction(decimal(c.value.commissionPercent)),
      losMultiplier: fraction(los),
      base: fraction(base),
      p1: fraction(p1),
      p2: fraction(p2),
      p3: fraction(p3),
      p4: fraction(p4),
      p5: fraction(p5),
      p6: fraction(p6),
      clamped:
        compare(p5, integer(i.room.minPrice)) <= 0
          ? 'floor'
          : compare(p5, integer(i.room.maxPrice)) >= 0
            ? 'ceiling'
            : null,
      nightlyPrice: safe(price),
      steps: values.map((v, index) => ({ step: index + 1, value: fraction(v) })),
    },
  };
}
