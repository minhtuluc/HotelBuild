import type { AvailabilityInput, Demand, NightRange } from '@pinehill/domain/inventory';
export function effectiveDemand(demand: Demand, now: Date): boolean {
  if (demand.status === 'CONFIRMED' || demand.status === 'CHECKED_IN') return true;
  return (
    ['HELD', 'PENDING_PAYMENT'].includes(demand.status) &&
    (demand.holdExpiresAt?.getTime() ?? 0) > now.getTime()
  );
}
/** Stream only the union of effective demand dates; no expansion of the block's empty years. */
export function* caseWindows(facts: AvailabilityInput): Generator<NightRange> {
  const intervals = facts.demand
    .filter((d) => {
      const location = d.allocatedLocation ?? d;
      return (
        location.propertyId === facts.propertyId &&
        location.roomTypeId === facts.roomTypeId &&
        effectiveDemand(d, facts.now)
      );
    })
    .map((d) => ({
      checkIn: [facts.checkIn, d.checkIn].sort().at(-1)!,
      checkOut: [facts.checkOut, d.checkOut].sort()[0]!,
    }))
    .filter((r) => r.checkIn < r.checkOut)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const merged: NightRange[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.checkIn <= last.checkOut) {
      merged[merged.length - 1] = {
        checkIn: last.checkIn,
        checkOut: [last.checkOut, interval.checkOut].sort().at(-1)!,
      };
    } else merged.push(interval);
  }
  for (const interval of merged) {
    let start = Date.parse(`${interval.checkIn}T00:00:00Z`);
    const end = Date.parse(`${interval.checkOut}T00:00:00Z`);
    while (start < end) {
      const next = Math.min(end, start + 31 * 86400000);
      yield {
        checkIn: new Date(start).toISOString().slice(0, 10),
        checkOut: new Date(next).toISOString().slice(0, 10),
      };
      start = next;
    }
  }
}
