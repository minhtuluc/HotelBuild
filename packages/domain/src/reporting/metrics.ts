import { err, ok } from '../shared/result.js';
import type { Result } from '../shared/result.js';
import type {
  ReportingInput,
  ReportingMetrics,
  ReportingFailure,
  ExactFraction,
  RoomNightFact,
  BookingFact,
  OverbookingCostFact,
} from './index.js';

function date(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function id(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
function integer(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
// Boolean wrapper avoids Array.isArray's any[] type predicate erasing readonly fact types.
function array(value: unknown): boolean {
  return Array.isArray(value);
}
function room(fact: RoomNightFact): boolean {
  return (
    Boolean(fact) &&
    id(fact.roomId) &&
    date(fact.businessDate) &&
    ['PRIVATE', 'DOR'].includes(fact.kind) &&
    capacity(fact) &&
    typeof fact.active === 'boolean' &&
    typeof fact.blocked === 'boolean' &&
    integer(fact.soldUnits) &&
    integer(fact.netRevenueVnd)
  );
}
function capacity(fact: RoomNightFact): boolean {
  return (
    integer(fact.bedCount) && fact.bedCount > 0 && (fact.kind !== 'PRIVATE' || fact.bedCount === 1)
  );
}
function booking(fact: BookingFact): boolean {
  return (
    Boolean(fact) &&
    id(fact.bookingId) &&
    date(fact.createdOn) &&
    typeof fact.cancelled === 'boolean'
  );
}
function cost(fact: OverbookingCostFact): boolean {
  return (
    Boolean(fact) &&
    date(fact.businessDate) &&
    [fact.mergeDiscountVnd, fact.walkOutCompensationVnd, fact.transportSupportVnd].every(integer)
  );
}
function unique<T>(
  facts: readonly T[],
  valid: (fact: T) => boolean,
  key: (fact: T) => string,
): boolean {
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!valid(fact)) return false;
    const identity = key(fact);
    if (seen.has(identity)) return false;
    seen.add(identity);
  }
  return true;
}
function valid(input: ReportingInput): boolean {
  return (
    Boolean(input) &&
    date(input.from) &&
    date(input.to) &&
    input.from < input.to &&
    array(input.roomNights) &&
    array(input.bookings) &&
    array(input.overbookingCosts) &&
    validFacts(input)
  );
}
function validFacts(input: ReportingInput): boolean {
  return (
    unique(input.roomNights, room, (fact) => JSON.stringify([fact.roomId, fact.businessDate])) &&
    unique(input.bookings, booking, (fact) => fact.bookingId) &&
    input.overbookingCosts.every(cost)
  );
}
function ratio(numerator: bigint, denominator: bigint): ExactFraction | null {
  return denominator === 0n ? null : { numerator, denominator };
}

/**
 * BR-REP-01. Caller supplies authorized snapshots, settled NET room revenue (BR-RATE-08)
 * and resolved cost facts. This function does not query DB, reprice bookings or issue refunds.
 * Totals retain original fraction numerators/denominators for SCR-52; never average daily ratios.
 */
export function calculateReportingMetrics(
  input: ReportingInput,
): Result<ReportingMetrics, ReportingFailure> {
  if (!valid(input))
    return err({ code: 'E_REPORT_INVALID_INPUT', message: 'Invalid reporting facts' });
  return aggregate(input);
}
function aggregate(input: ReportingInput): Result<ReportingMetrics, ReportingFailure> {
  const inPeriod = (day: string) => day >= input.from && day < input.to;
  const roomFacts = input.roomNights.filter((fact) => inPeriod(fact.businessDate));
  const bookingFacts = input.bookings.filter((fact) => inPeriod(fact.createdOn));
  const costFacts = input.overbookingCosts.filter((fact) => inPeriod(fact.businessDate));
  let sold = 0n,
    available = 0n,
    net = 0n,
    created = 0n,
    cancelled = 0n;
  let discount = 0n,
    compensation = 0n,
    transport = 0n;
  for (const fact of roomFacts) {
    sold += BigInt(fact.soldUnits);
    net += BigInt(fact.netRevenueVnd);
    if (fact.active && !fact.blocked) available += fact.kind === 'DOR' ? BigInt(fact.bedCount) : 1n;
  }
  for (const fact of bookingFacts) {
    created++;
    if (fact.cancelled) cancelled++;
  }
  for (const fact of costFacts) {
    discount += BigInt(fact.mergeDiscountVnd);
    compensation += BigInt(fact.walkOutCompensationVnd);
    transport += BigInt(fact.transportSupportVnd);
  }
  const totalCost = discount + compensation + transport;
  if (
    [sold, available, net, created, cancelled, discount, compensation, transport, totalCost].some(
      (amount) => amount > BigInt(Number.MAX_SAFE_INTEGER),
    )
  )
    return err({
      code: 'E_REPORT_UNSAFE_TOTAL',
      message: 'Report total exceeds safe integer range',
    });
  return ok({
    soldUnitNights: Number(sold),
    availableUnitNights: Number(available),
    netRevenueVnd: Number(net),
    bookingsCreated: Number(created),
    cancelledBookings: Number(cancelled),
    occupancy: ratio(sold, available),
    adr: ratio(net, sold),
    revpar: ratio(net, available),
    cancellationRate: ratio(cancelled, created),
    overbookingCost: {
      mergeDiscountVnd: Number(discount),
      walkOutCompensationVnd: Number(compensation),
      transportSupportVnd: Number(transport),
      totalVnd: Number(totalCost),
    },
  });
}
