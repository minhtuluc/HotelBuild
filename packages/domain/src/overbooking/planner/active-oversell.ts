import { err, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

export interface ActiveOversellInput {
  readonly kind: 'ACTIVE_SALE';
  readonly propertyId: string;
  /** Physical ACTIVE rooms at this property, not selling units/dorm beds or chain-wide supply. */
  readonly activePhysicalRooms: number;
  /** Exact decimal percentage matching numeric(4,2), in [0,5]; omitted defaults to zero. */
  readonly overbookLimitPct?: string;
  readonly channel: { readonly overbookAllowed: boolean };
  /** Complete affected nights, with total shortage AFTER the proposed sale, including existing OTA. */
  readonly nightly: readonly {
    /** Caller-normalized valid Vietnamese civil YYYY-MM-DD. */
    readonly date: string;
    readonly projectedOversoldRooms: number;
  }[];
}

/** Caller authenticates the OTA and establishes its confirmation before choosing this boundary. */
export interface ConfirmedOtaCommitment {
  readonly kind: 'CONFIRMED_OTA_COMMITMENT';
  readonly channelCode: 'OTA_BOOKING' | 'OTA_AGODA' | 'OTA_AIRBNB';
}

export type ActiveOversellDecision =
  | { readonly kind: 'ACTIVE_SALE'; readonly dailyLimit: number }
  | { readonly kind: 'CONFIRMED_OTA_EXEMPT' };

export type ActiveOversellFailure =
  | { readonly code: 'E_OVER_INVALID_INPUT'; readonly message: string }
  | {
      readonly code: 'E_OVER_LIMIT_EXCEEDED';
      readonly propertyId: string;
      readonly date: string;
      readonly dailyLimit: number;
      readonly projectedOversoldRooms: number;
    };

function percentageHundredths(pct: string): bigint | null {
  if (typeof pct !== 'string' || !/^\d{1,2}(?:\.\d{1,2})?$/.test(pct)) return null;
  const point = pct.indexOf('.');
  const whole = point < 0 ? pct : pct.slice(0, point);
  const fractional = point < 0 ? '00' : pct.slice(point + 1).padEnd(2, '0');
  const value = BigInt(whole) * 100n + BigInt(fractional);
  return value <= 500n ? value : null;
}

function roomCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validSnapshot(input: ActiveOversellInput): boolean {
  return (
    input.propertyId.trim().length > 0 &&
    roomCount(input.activePhysicalRooms) &&
    typeof input.channel.overbookAllowed === 'boolean' &&
    input.nightly.length > 0
  );
}

function validNights(nightly: ActiveOversellInput['nightly']): boolean {
  const dates = new Set<string>();
  for (const night of nightly) {
    if (
      !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(night.date) ||
      dates.has(night.date) ||
      !roomCount(night.projectedOversoldRooms)
    )
      return false;
    dates.add(night.date);
  }
  return true;
}

function propertyLimit(input: ActiveOversellInput, hundredths: bigint): number {
  if (hundredths === 0n || !input.channel.overbookAllowed) return 0;
  // Exact hundredths-of-percent denominator. Safe room input guarantees a safe output limit.
  const ceiling = (BigInt(input.activePhysicalRooms) * hundredths + 9999n) / 10_000n;
  return Number(ceiling < 1n ? 1n : ceiling);
}

/**
 * BR-OVER-01/02 checks one property's proposed active sale against every affected night.
 * Ordinary sales with zero shortage pass even when active overselling is disabled.
 * BR-CHAN-03/08 external commitments bypass this guard; exemption is not workflow approval.
 * Callers load/count ACTIVE physical rooms and projected shortages under their lock/TX;
 * this function does not reserve inventory or verify allotments, permissions or OTA authenticity.
 */
export function checkActiveOversell(
  input: ActiveOversellInput | ConfirmedOtaCommitment,
): Result<ActiveOversellDecision, ActiveOversellFailure> {
  if (input.kind === 'CONFIRMED_OTA_COMMITMENT') return ok({ kind: 'CONFIRMED_OTA_EXEMPT' });

  const hundredths = percentageHundredths(input.overbookLimitPct ?? '0');
  if (hundredths === null)
    return err({
      code: 'E_OVER_INVALID_INPUT',
      message: 'Percentage must be an exact decimal string between zero and five',
    });
  if (!validSnapshot(input))
    return err({
      code: 'E_OVER_INVALID_INPUT',
      message: 'Expected property ID, nonnegative safe room count, permission and affected nights',
    });

  if (!validNights(input.nightly))
    return err({
      code: 'E_OVER_INVALID_INPUT',
      message: 'Expected distinct normalized dates and nonnegative safe projected shortages',
    });

  const dailyLimit = propertyLimit(input, hundredths);
  for (const night of [...input.nightly].sort((left, right) => (left.date < right.date ? -1 : 1))) {
    if (night.projectedOversoldRooms > dailyLimit)
      return err({
        code: 'E_OVER_LIMIT_EXCEEDED',
        propertyId: input.propertyId,
        date: night.date,
        dailyLimit,
        projectedOversoldRooms: night.projectedOversoldRooms,
      });
  }
  return ok({ kind: 'ACTIVE_SALE', dailyLimit });
}
