import { err, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

export type LoyaltyTier = 'PLATINUM' | 'GOLD' | 'SILVER' | 'MEMBER' | 'GUEST';

/** Booking states the planner may receive; only HELD/CHECKED_IN change scoring. */
export type KeepScoreBookingStatus =
  | 'DRAFT'
  | 'HELD'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';

export type RelocationChannelCode =
  'WEB' | 'PHONE' | 'WALKIN' | 'OTA_BOOKING' | 'OTA_AGODA' | 'OTA_AIRBNB' | 'AGENCY';

/** BR-OVER-12 order is applied before the score keys: WEAK is relocated first. */
export type KeepPriorityGroup = 'WEAK' | 'STRONG';

/**
 * Facts BR-OVER-11 needs. `arrivalAtEpochMs` is the nominal check-in instant (VN time) already
 * converted by the caller; `nowEpochMs` is the evaluation instant. The engine reads no clock.
 */
export interface KeepScoreFactors {
  readonly loyaltyTier: LoyaltyTier;
  readonly paidAmountVnd: number;
  readonly totalAmountVnd: number;
  readonly depositAmountVnd: number;
  readonly nights: number;
  readonly staysLast12Months: number;
  readonly status: KeepScoreBookingStatus;
  readonly arrivalAtEpochMs: number;
  readonly nowEpochMs: number;
}

/** Per-component breakdown so managers can see why a booking is relocated first. */
export interface KeepScoreBreakdown {
  readonly loyaltyPoints: number;
  readonly paymentPoints: number;
  readonly nightPoints: number;
  readonly repeatGuestPoints: number;
  readonly arrivalPoints: number;
  readonly total: number;
}

export interface KeepScoreFailure {
  readonly code: 'E_OVER_INVALID_INPUT';
  readonly message: string;
}

export interface RelocationCandidate extends KeepScoreFactors {
  readonly bookingId: string;
  readonly channelCode: RelocationChannelCode;
  /** `Booking.seq` (bigserial) as bigint or exact decimal string; never coerced to Number. */
  readonly seq: bigint | string;
  /** `Booking.createdAt` as epoch milliseconds UTC. */
  readonly createdAtEpochMs: number;
}

export interface RelocationRank {
  readonly bookingId: string;
  readonly priorityGroup: KeepPriorityGroup;
  readonly keepScore: number;
  readonly components: KeepScoreBreakdown;
  readonly createdAtEpochMs: number;
  readonly seq: bigint;
}

const LOYALTY_POINTS: Readonly<Record<LoyaltyTier, number>> = {
  PLATINUM: 100,
  GOLD: 80,
  SILVER: 50,
  MEMBER: 20,
  GUEST: 0,
};
const KNOWN_STATUS: Readonly<Record<KeepScoreBookingStatus, true>> = {
  DRAFT: true,
  HELD: true,
  PENDING_PAYMENT: true,
  CONFIRMED: true,
  CHECKED_IN: true,
  CHECKED_OUT: true,
  CANCELLED: true,
  NO_SHOW: true,
  EXPIRED: true,
};
const KNOWN_CHANNEL: Readonly<Record<RelocationChannelCode, true>> = {
  WEB: true,
  PHONE: true,
  WALKIN: true,
  OTA_BOOKING: true,
  OTA_AGODA: true,
  OTA_AIRBNB: true,
  AGENCY: true,
};
const MAX_NIGHTS = 14;
const NIGHT_POINTS = 2;
const REPEAT_GUEST_STAYS = 3;
const REPEAT_GUEST_POINTS = 15;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ARRIVAL_POINTS = 10;
const FULL_PAYMENT_POINTS = 20;
const DEPOSIT_POINTS = 10;

function invalid(message: string): Result<never, KeepScoreFailure> {
  return err({ code: 'E_OVER_INVALID_INPUT', message });
}

function amount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function instant(value: number): boolean {
  return Number.isSafeInteger(value);
}

function validFactors(factors: KeepScoreFactors): boolean {
  return (
    Object.hasOwn(LOYALTY_POINTS, factors.loyaltyTier) &&
    Object.hasOwn(KNOWN_STATUS, factors.status) &&
    amount(factors.paidAmountVnd) &&
    amount(factors.totalAmountVnd) &&
    amount(factors.depositAmountVnd) &&
    amount(factors.nights) &&
    amount(factors.staysLast12Months) &&
    instant(factors.arrivalAtEpochMs) &&
    instant(factors.nowEpochMs)
  );
}

/**
 * F6-D08 branch table, applied in order, first match wins:
 * `paid = 0` → 0; `paid ≥ total` → 20; `paid > 0` and (`deposit = 0` or `paid ≥ deposit`) → 10;
 * `0 < paid < deposit` → 0. Because `paid = 0` is consumed first, `paid ≥ total` also covers
 * total 0 with an overpayment, which D08/BR-OVER §9.3 score as 20 ("không còn nợ").
 */
function paymentPoints(factors: KeepScoreFactors): number {
  const paid = factors.paidAmountVnd;
  if (paid === 0) return 0;
  if (paid >= factors.totalAmountVnd) return FULL_PAYMENT_POINTS;
  if (factors.depositAmountVnd === 0 || paid >= factors.depositAmountVnd) return DEPOSIT_POINTS;
  return 0;
}

/**
 * CHECKED_IN counts as arrived. Otherwise arrival points apply inside the inclusive window
 * `0 ≤ arrival − now ≤ 6h`: an arrival that already passed without CHECKED_IN is a status problem
 * for the caller, not evidence the guest is on site.
 */
function arrivalPoints(factors: KeepScoreFactors): number {
  if (factors.status === 'CHECKED_IN') return ARRIVAL_POINTS;
  const remaining = factors.arrivalAtEpochMs - factors.nowEpochMs;
  return remaining >= 0 && remaining <= SIX_HOURS_MS ? ARRIVAL_POINTS : 0;
}

function breakdown(factors: KeepScoreFactors): KeepScoreBreakdown {
  const loyaltyPoints = LOYALTY_POINTS[factors.loyaltyTier];
  const payment = paymentPoints(factors);
  const nightPoints = Math.min(factors.nights, MAX_NIGHTS) * NIGHT_POINTS;
  const repeatGuestPoints =
    factors.staysLast12Months >= REPEAT_GUEST_STAYS ? REPEAT_GUEST_POINTS : 0;
  const arrivedPoints = arrivalPoints(factors);
  return {
    loyaltyPoints,
    paymentPoints: payment,
    nightPoints,
    repeatGuestPoints,
    arrivalPoints: arrivedPoints,
    total: loyaltyPoints + payment + nightPoints + repeatGuestPoints + arrivedPoints,
  };
}

/** BR-OVER-11 component score. Pure: no clock, IDs, randomness or I/O. */
export function keepScore(factors: KeepScoreFactors): Result<KeepScoreBreakdown, KeepScoreFailure> {
  if (!validFactors(factors)) return invalid('Invalid keepScore factors');
  return ok(breakdown(factors));
}

/** BR-OVER-12: HELD, and WALKIN that has paid nothing, are relocated before every other booking. */
function priorityGroup(candidate: RelocationCandidate): KeepPriorityGroup {
  return candidate.status === 'HELD' ||
    (candidate.channelCode === 'WALKIN' && candidate.paidAmountVnd === 0)
    ? 'WEAK'
    : 'STRONG';
}

function seqOf(value: bigint | string): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  return BigInt(value);
}

function groupRank(group: KeepPriorityGroup): number {
  return group === 'WEAK' ? 0 : 1;
}

/** Total order: group WEAK first, then keepScore ↑, createdAt ↓, Booking.seq ↑. */
function compareRanks(left: RelocationRank, right: RelocationRank): number {
  const group = groupRank(left.priorityGroup) - groupRank(right.priorityGroup);
  if (group !== 0) return group;
  if (left.keepScore !== right.keepScore) return left.keepScore - right.keepScore;
  if (left.createdAtEpochMs !== right.createdAtEpochMs)
    return right.createdAtEpochMs - left.createdAtEpochMs;
  return left.seq < right.seq ? -1 : left.seq > right.seq ? 1 : 0;
}

/**
 * BR-OVER-11/12 relocation list: index 0 is relocated first. Every rank carries the components
 * and the tiebreak keys so the manager-facing explanation does not recompute anything.
 * `seq` must be unique; UUID (`bookingId`) is never a tiebreak key. Input is not mutated.
 */
export function rankRelocations(
  candidates: readonly RelocationCandidate[],
): Result<readonly RelocationRank[], KeepScoreFailure> {
  const ranks: RelocationRank[] = [];
  const seqs = new Set<bigint>();
  for (const candidate of candidates) {
    if (candidate.bookingId.trim().length === 0) return invalid('Booking id must not be blank');
    if (!Object.hasOwn(KNOWN_CHANNEL, candidate.channelCode))
      return invalid('Unknown channel code');
    if (!instant(candidate.createdAtEpochMs) || candidate.createdAtEpochMs < 0)
      return invalid('Invalid booking creation instant');
    const seq = seqOf(candidate.seq);
    if (seq === null) return invalid('Invalid Booking.seq');
    if (seqs.has(seq)) return invalid(`Duplicate Booking.seq ${seq}`);
    seqs.add(seq);
    const scored = keepScore(candidate);
    if (!scored.ok) return err(scored.error);
    ranks.push({
      bookingId: candidate.bookingId,
      priorityGroup: priorityGroup(candidate),
      keepScore: scored.value.total,
      components: scored.value,
      createdAtEpochMs: candidate.createdAtEpochMs,
      seq,
    });
  }
  ranks.sort(compareRanks);
  return ok(ranks);
}
