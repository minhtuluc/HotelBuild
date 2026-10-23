import { compare, decimal, integer, percent, requireValid, ONE } from './arithmetic.js';
import type { PricingInput } from './index.js';
export const DAY = 86400000;
/** YYYY-MM-DD is an already resolved Vietnamese civil date, never a host timezone date. */
export function dateDay(value: string): number {
  requireValid(/^\d{4}-\d{2}-\d{2}$/.test(value), 'Expected YYYY-MM-DD');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  requireValid(
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value,
    'Invalid civil date',
  );
  return time / DAY;
}
export function dateString(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}
export function timestamp(n: number): void {
  requireValid(Number.isSafeInteger(n) && n >= 0, 'Invalid timestamp');
}
function positive(value: string): void {
  requireValid(compare(decimal(value), integer(0)) > 0, 'Multiplier must be positive');
}
function range(from: string, to: string): void {
  requireValid(dateDay(from) <= dateDay(to), 'Reversed configuration date range');
}
function unique(values: readonly string[]): void {
  requireValid(
    values.every((v) => v.length > 0) && new Set(values).size === values.length,
    'Empty or duplicate identity',
  );
}
function validateUnits(units: number | undefined): void {
  requireValid(
    units === undefined || (Number.isSafeInteger(units) && units >= 1 && units <= 1000),
    'Units must be an integer between 1 and 1000',
  );
}
function validateStay(i: PricingInput): number {
  const nights = dateDay(i.checkOut) - dateDay(i.checkIn);
  timestamp(i.now);
  unique([i.propertyId]);
  unique([i.room.id]);
  unique([i.ratePlan.id]);
  integer(i.room.basePrice);
  integer(i.room.minPrice);
  integer(i.room.maxPrice);
  requireValid(
    i.room.minPrice <= i.room.maxPrice &&
      i.room.minPrice % 1000 === 0 &&
      i.room.maxPrice % 1000 === 0,
    'Bounds must be ordered multiples of 1000',
  );
  requireValid(
    Number.isSafeInteger(i.ratePlan.minNights) &&
      Number.isSafeInteger(i.ratePlan.maxNights) &&
      i.ratePlan.minNights >= 1 &&
      i.ratePlan.maxNights >= i.ratePlan.minNights &&
      nights >= i.ratePlan.minNights &&
      nights <= i.ratePlan.maxNights,
    'Stay outside rate plan bounds',
  );
  percent(i.ratePlan.depositPercent);
  validateUnits(i.units);
  if (i.ratePlan.fixedNightlyPrice !== undefined) integer(i.ratePlan.fixedNightlyPrice);
  return nights;
}
function validateCollections(i: PricingInput): void {
  unique(i.seasons.map((s) => s.id));
  unique(i.calendar.map((s) => s.id));
  unique(i.channels.map((s) => s.code));
  unique(i.channelSettings.map((s) => s.id));
  unique(i.occupancy.map((s) => s.id));
  unique(i.promotions.map((s) => s.code));
  for (const s of i.seasons) {
    range(s.from, s.to);
    timestamp(s.createdAt);
    requireValid(Number.isSafeInteger(s.priority), 'Invalid season priority');
    positive(s.multiplier);
  }
  for (const c of i.calendar) {
    range(c.from, c.to);
    timestamp(c.createdAt);
    integer(c.price);
    requireValid(
      ['OVERRIDE', 'RATE_PLAN', 'SEASON', 'BASE'].includes(c.source),
      'Invalid calendar source',
    );
    requireValid(
      c.source !== 'RATE_PLAN' || Boolean(c.ratePlanId),
      'RATE_PLAN requires ratePlanId',
    );
  }
  for (const c of i.channels) {
    positive(c.multiplier);
    percent(c.commissionPercent);
  }
  for (const c of i.channelSettings) {
    if (c.multiplier !== undefined) positive(c.multiplier);
    percent(c.commissionPercent);
    dateDay(c.effectiveFrom);
  }
  requireValid(
    i.channels.some((c) => c.code === i.channelCode),
    'Unknown channel',
  );
  for (const s of i.occupancy) {
    dateDay(s.date);
    integer(s.demand);
    integer(s.supply);
    timestamp(s.capturedAt);
    requireValid(s.capturedAt <= i.now, 'Future occupancy snapshot');
  }
}
function validatePromotions(i: PricingInput): void {
  for (const p of i.promotions) {
    timestamp(p.validFrom);
    timestamp(p.validTo);
    requireValid(p.validFrom < p.validTo, 'Invalid promotion validity');
    integer(p.uses);
    if (p.maxUses !== undefined) integer(p.maxUses);
    requireValid(['AMOUNT', 'PERCENT'].includes(p.kind), 'Invalid promotion kind');
    if (p.kind === 'AMOUNT') {
      requireValid(/^\d+$/.test(p.value), 'AMOUNT must be integer');
      decimal(p.value);
    } else percent(p.value);
  }
}
function validateSettings(i: PricingInput): void {
  const s = i.settings;
  positive(s.weekendMultiplier);
  positive(s.occupancyMidMultiplier);
  positive(s.occupancyHighMultiplier);
  percent(s.occupancyMidPercent);
  percent(s.occupancyHighPercent);
  percent(s.maxDiscountPercent);
  integer(s.occupancyFreshnessMs);
  requireValid(
    compare(decimal(s.occupancyMidPercent), decimal(s.occupancyHighPercent)) < 0,
    'Occupancy thresholds must be ordered',
  );
  unique(s.los.map((x) => String(x.minNights)));
  for (const l of s.los) {
    requireValid(Number.isSafeInteger(l.minNights) && l.minNights >= 1, 'Invalid LOS threshold');
    positive(l.multiplier);
    requireValid(compare(decimal(l.multiplier), ONE) <= 0, 'LOS multiplier exceeds one');
  }
}

export function validate(i: PricingInput): number {
  const nights = validateStay(i);
  validateCollections(i);
  validatePromotions(i);
  validateSettings(i);
  return nights;
}
