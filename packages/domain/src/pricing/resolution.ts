import {
  compare,
  decimal,
  integer,
  multiply,
  ONE,
  percent,
  requireValid,
  subtract,
  PricingFailure,
} from './arithmetic.js';
import type { Rational } from './arithmetic.js';
import type { CalendarSource, Channel, PricingInput } from './index.js';
import { dateDay } from './validation.js';
const PRIORITY: Record<CalendarSource, number> = {
  OVERRIDE: 100,
  RATE_PLAN: 90,
  SEASON: 50,
  BASE: 10,
};
export function lexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function baseRate(
  i: PricingInput,
  date: string,
): { price: number; source: CalendarSource | 'ROOM_TYPE'; id: string | null } {
  const rows = i.calendar
    .filter(
      (c) =>
        c.roomTypeId === i.room.id &&
        (!c.propertyId || c.propertyId === i.propertyId) &&
        c.from <= date &&
        date <= c.to &&
        (!c.channelCode || c.channelCode === i.channelCode) &&
        (c.source !== 'RATE_PLAN' || c.ratePlanId === i.ratePlan.id),
    )
    .sort(
      (a, b) =>
        PRIORITY[b.source] - PRIORITY[a.source] ||
        Number(Boolean(b.channelCode)) - Number(Boolean(a.channelCode)) ||
        a.createdAt - b.createdAt ||
        lexical(a.id, b.id),
    );
  const c = rows[0];
  if (c && (PRIORITY[c.source] >= 90 || i.ratePlan.fixedNightlyPrice === undefined))
    return { price: c.price, source: c.source, id: c.id };
  if (i.ratePlan.fixedNightlyPrice !== undefined)
    return { price: i.ratePlan.fixedNightlyPrice, source: 'RATE_PLAN', id: null };
  return { price: i.room.basePrice, source: 'ROOM_TYPE', id: null };
}
export function season(i: PricingInput, date: string) {
  const matches = i.seasons
    .filter(
      (s) => (!s.propertyId || s.propertyId === i.propertyId) && s.from <= date && date <= s.to,
    )
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        dateDay(a.to) - dateDay(a.from) - (dateDay(b.to) - dateDay(b.from)) ||
        a.createdAt - b.createdAt,
    );
  // Fully indistinguishable winning rows are invalid loaded configuration: no UUID tie-break in BR-RATE-05.
  const a = matches[0],
    b = matches[1];
  requireValid(
    !(
      a &&
      b &&
      a.priority === b.priority &&
      dateDay(a.to) - dateDay(a.from) === dateDay(b.to) - dateDay(b.from) &&
      a.createdAt === b.createdAt
    ),
    'Ambiguous season configuration',
  );
  return a;
}
export function channel(
  i: PricingInput,
  date: string,
  code = i.channelCode,
): { value: Channel; id: string | null } {
  const setting = channelSetting(i, date, code);
  const fallback = i.channels.find((c) => c.code === code);
  if (!fallback) throw new PricingFailure('E_RATE_INVALID_INPUT', 'Unknown channel');
  const value: Channel = {
    code,
    multiplier: setting?.multiplier ?? fallback.multiplier,
    commissionPercent: setting?.commissionPercent ?? fallback.commissionPercent,
  };
  validateCommission(code, value);
  return { value, id: setting?.id ?? null };
}
export function occupancy(
  i: PricingInput,
  date: string,
): {
  multiplier: Rational;
  id: string | null;
  capturedAt: number | null;
  zeroDemandSupply: boolean;
} {
  const snapshots = i.occupancy
    .filter((s) => s.propertyId === i.propertyId && s.roomTypeId === undefined && s.date === date)
    .sort((a, b) => b.capturedAt - a.capturedAt || lexical(a.id, b.id));
  const s = snapshots[0];
  if (!s) return { multiplier: ONE, id: null, capturedAt: null, zeroDemandSupply: false };
  const metadata = {
    id: s.id,
    capturedAt: s.capturedAt,
    zeroDemandSupply: s.supply === 0 && s.demand > 0,
  };
  if (i.now - s.capturedAt > i.settings.occupancyFreshnessMs || s.supply === 0)
    return { ...metadata, multiplier: ONE };
  const demand = integer(s.demand),
    supply = integer(s.supply);
  const pct = { n: demand.n * 100n, d: supply.n };
  const multiplier =
    compare(pct, decimal(i.settings.occupancyHighPercent)) >= 0
      ? decimal(i.settings.occupancyHighMultiplier)
      : compare(pct, decimal(i.settings.occupancyMidPercent)) >= 0
        ? decimal(i.settings.occupancyMidMultiplier)
        : ONE;
  return { ...metadata, multiplier };
}

function validateCommission(code: string, value: Channel): void {
  if (code !== 'AGENCY' && compare(percent(value.commissionPercent), integer(0)) > 0)
    requireValid(
      compare(
        multiply(decimal(value.multiplier), subtract(ONE, percent(value.commissionPercent))),
        ONE,
      ) >= 0,
      'Channel multiplier below commission floor',
    );
}

function channelSetting(i: PricingInput, date: string, code: string) {
  const settings = i.channelSettings
    .filter(
      (c) => c.propertyId === i.propertyId && c.channelCode === code && c.effectiveFrom <= date,
    )
    .sort((a, b) => lexical(b.effectiveFrom, a.effectiveFrom));
  requireValid(
    !(settings[0] && settings[1] && settings[0].effectiveFrom === settings[1].effectiveFrom),
    'Ambiguous channel effective date',
  );
  return settings[0];
}
