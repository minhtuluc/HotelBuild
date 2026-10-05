import type { CheckInInput, CheckInUnit } from './index.js';

function money(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function id(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
function date(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validClock(clock: CheckInInput['localNow']): boolean {
  return (
    date(clock.date) &&
    clock.timeZone === 'Asia/Ho_Chi_Minh' &&
    money(clock.millisecondsSinceMidnight) &&
    clock.millisecondsSinceMidnight < 86_400_000
  );
}
function validLimits(limits: CheckInInput['managerDebtLimits']): boolean {
  return (
    limits === undefined || (money(limits.amount) && money(limits.percent) && limits.percent <= 100)
  );
}
function validApproval(approval: CheckInInput['debtApproval']): boolean {
  return (
    approval === null ||
    (id(approval.bookingId) && money(approval.amount) && typeof approval.approverRole === 'string')
  );
}
function validUnit(unit: CheckInUnit): boolean {
  return (
    id(unit.roomId) &&
    money(unit.bedNo) &&
    typeof unit.blockedAtHandover === 'boolean' &&
    typeof unit.occupiedAtHandover === 'boolean'
  );
}
function validUnits(units: readonly CheckInUnit[]): boolean {
  if (units.length === 0) return false;
  const seen = new Set<string>();
  for (const unit of units) {
    if (!validUnit(unit)) return false;
    const key = JSON.stringify([unit.roomId, unit.bedNo]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function validInput(input: CheckInInput): boolean {
  return (
    id(input.bookingId) &&
    date(input.checkInDate) &&
    validClock(input.localNow) &&
    [input.totalAmount, input.balanceDue, input.firstNightAmount].every(money) &&
    validLimits(input.managerDebtLimits) &&
    validApproval(input.debtApproval) &&
    validUnits(input.units)
  );
}
