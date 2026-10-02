import type { Result } from '../shared/result.js';
/** Exact normalized rational with positive denominator; JSON-safe snapshot strings. */
export interface Fraction {
  readonly numerator: string;
  readonly denominator: string;
}
export interface RoomRate {
  readonly id: string;
  readonly basePrice: number;
  readonly minPrice: number;
  readonly maxPrice: number;
}
export interface RatePlan {
  readonly id: string;
  readonly minNights: number;
  readonly maxNights: number;
  readonly losDiscountEnabled: boolean;
  readonly depositPercent: string;
  readonly fixedNightlyPrice?: number;
}
export interface Season {
  readonly id: string;
  readonly propertyId?: string;
  readonly from: string;
  readonly to: string;
  readonly priority: number;
  readonly createdAt: number;
  readonly multiplier: string;
  readonly weekendSurchargeEnabled: boolean;
}
export type CalendarSource = 'OVERRIDE' | 'RATE_PLAN' | 'SEASON' | 'BASE';
export interface CalendarRate {
  readonly id: string;
  readonly propertyId?: string;
  readonly roomTypeId: string;
  readonly from: string;
  readonly to: string;
  readonly channelCode?: string;
  readonly ratePlanId?: string;
  readonly source: CalendarSource;
  readonly price: number;
  readonly createdAt: number;
}
export interface Channel {
  readonly code: string;
  readonly multiplier: string;
  readonly commissionPercent: string;
}
/** A missing multiplier inherits the chain default, while commission and ID remain dated. */
export interface ChannelSetting {
  readonly id: string;
  readonly propertyId: string;
  readonly channelCode: string;
  readonly effectiveFrom: string;
  readonly multiplier?: string;
  readonly commissionPercent: string;
}
/** demand/supply are property-wide BR-INV-01 selling units, including beds. */
export interface Occupancy {
  readonly id: string;
  readonly propertyId: string;
  readonly roomTypeId?: string;
  readonly date: string;
  readonly demand: number;
  readonly supply: number;
  readonly capturedAt: number;
}
export interface Promotion {
  readonly code: string;
  readonly kind: 'AMOUNT' | 'PERCENT';
  readonly value: string;
  readonly stackable: boolean;
  readonly validFrom: number;
  readonly validTo: number;
  readonly uses: number;
  readonly maxUses?: number;
}
export interface PricingSettings {
  readonly weekendMultiplier: string;
  readonly occupancyMidPercent: string;
  readonly occupancyHighPercent: string;
  readonly occupancyMidMultiplier: string;
  readonly occupancyHighMultiplier: string;
  readonly occupancyFreshnessMs: number;
  readonly maxDiscountPercent: string;
  readonly los: readonly { readonly minNights: number; readonly multiplier: string }[];
}
/** Dates are Vietnamese civil YYYY-MM-DD; timestamps are supplied epoch milliseconds.
 * Multipliers and percentages are exact decimal strings (up to 18 decimal places).
 * RateCalendar/Season ranges include both dates; stay checkOut is exclusive.
 */
export interface PricingInput {
  readonly propertyId: string;
  readonly room: RoomRate;
  readonly ratePlan: RatePlan;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly channelCode: string;
  readonly now: number;
  readonly seasons: readonly Season[];
  readonly calendar: readonly CalendarRate[];
  readonly channels: readonly Channel[];
  readonly channelSettings: readonly ChannelSetting[];
  readonly occupancy: readonly Occupancy[];
  readonly promotions: readonly Promotion[];
  readonly settings: PricingSettings;
}
export type PricingWarning =
  | 'E_RATE_ZERO_SUPPLY'
  | 'E_RATE_DISCOUNT_CAPPED'
  | 'E_RATE_BELOW_FLOOR'
  | 'E_RATE_CHANNEL_PARITY'
  | 'E_RATE_DIRECT_BELOW_BASE';
export interface PricingError {
  readonly code: 'E_RATE_INVALID_INPUT' | 'E_RATE_PROMOTION_INVALID' | 'E_RATE_UNSAFE_AMOUNT';
  readonly message: string;
}
export interface PriceStep {
  readonly step: number;
  readonly value: Fraction;
}
export interface NightPrice {
  readonly date: string;
  readonly baseSource: CalendarSource | 'ROOM_TYPE';
  readonly calendarId: string | null;
  readonly seasonId: string | null;
  readonly occupancySnapshotId: string | null;
  readonly occupancyCapturedAt: number | null;
  readonly channelSettingId: string | null;
  readonly commissionPercent: Fraction;
  readonly losMultiplier: Fraction;
  readonly base: Fraction;
  readonly p1: Fraction;
  readonly p2: Fraction;
  readonly p3: Fraction;
  readonly p4: Fraction;
  readonly p5: Fraction;
  readonly p6: Fraction;
  readonly clamped: 'floor' | 'ceiling' | null;
  readonly nightlyPrice: number;
  readonly steps: readonly PriceStep[];
}
export interface PriceQuote {
  readonly engineVersion: string;
  readonly propertyId: string;
  readonly roomTypeId: string;
  readonly ratePlanId: string;
  readonly channelCode: string;
  readonly quotedAt: number;
  readonly nights: readonly NightPrice[];
  readonly subtotal: number;
  readonly discountAmount: Fraction;
  readonly total: number;
  readonly depositAmount: number;
  readonly appliedPromotions: readonly string[];
  readonly warnings: readonly PricingWarning[];
}
export type PricingResult = Result<PriceQuote, PricingError>;

import { err, ok } from '../shared/result.js';
import {
  ceil1000,
  floor1000,
  fraction,
  integer,
  multiply,
  percent,
  PricingFailure,
  rational,
  safe,
  subtract,
} from './arithmetic.js';
import { nightly, losMultiplier } from './nightly.js';
import { promotions } from './promotions.js';
import { dateDay, dateString, validate } from './validation.js';
export const ENGINE_VERSION = 'pricing-1.0.0';
/** Pure loaded-configuration quote; callers resolve Vietnamese dates and transactional promotion usage. */
export function quotePrice(i: PricingInput): PricingResult {
  try {
    const count = validate(i),
      min = integer(i.room.minPrice);
    const start = dateDay(i.checkIn),
      warnings: PricingWarning[] = [],
      nights: NightPrice[] = [];
    const los = losMultiplier(i, count);
    let subtotal = 0n;
    for (let n = 0; n < count; n++) {
      const result = nightly(i, dateString(start + n), los);
      subtotal += BigInt(result.night.nightlyPrice);
      nights.push(result.night);
      warnings.push(...result.warnings);
    }
    const sub = rational(subtotal),
      p = promotions(i, sub, multiply(min, integer(count))),
      total = floor1000(subtract(sub, p.discount));
    return ok({
      engineVersion: ENGINE_VERSION,
      propertyId: i.propertyId,
      roomTypeId: i.room.id,
      ratePlanId: i.ratePlan.id,
      channelCode: i.channelCode,
      quotedAt: i.now,
      nights: nights.map((n) => ({
        ...n,
        steps: [
          ...n.steps,
          { step: 9, value: fraction(sub) },
          { step: 10, value: fraction(p.discount) },
          { step: 11, value: fraction(rational(total)) },
        ],
      })),
      subtotal: safe(subtotal),
      discountAmount: fraction(p.discount),
      total: safe(total),
      depositAmount: safe(ceil1000(multiply(rational(total), percent(i.ratePlan.depositPercent)))),
      appliedPromotions: p.codes,
      warnings: [
        ...new Set([
          ...warnings.filter((w) => w !== 'E_RATE_DIRECT_BELOW_BASE' || p.codes.length === 0),
          ...p.warnings,
        ]),
      ],
    });
  } catch (error) {
    if (error instanceof PricingFailure) return err({ code: error.code, message: error.message });
    throw error;
  }
}
