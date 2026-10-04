import { err, ok } from '../shared/result.js';
import type { Result } from '../shared/result.js';
import type { CheckInInput, CheckInDecision, CheckInFailure, CheckInUnit } from './index.js';
import { validInput } from './validation.js';

type Refusal = Extract<CheckInFailure, { code: 'E_FO_CHECKIN_NOT_ALLOWED' }>;
function refuse(reason: Refusal['reason']): Result<never, Refusal> {
  return err({ code: 'E_FO_CHECKIN_NOT_ALLOWED', reason });
}

function approvedDebt(input: CheckInInput): boolean {
  if (input.balanceDue === 0) return true;
  const approval = input.debtApproval;
  if (!approval || approval.bookingId !== input.bookingId || approval.amount < input.balanceDue)
    return false;
  if (approval.approverRole === 'OWNER') return true;
  const limits = input.managerDebtLimits ?? { amount: 5_000_000, percent: 50 };
  return (
    approval.approverRole === 'MANAGER' &&
    input.balanceDue <= limits.amount &&
    BigInt(input.balanceDue) * 100n <= BigInt(input.totalAmount) * BigInt(limits.percent)
  );
}

function ready(unit: CheckInUnit): boolean {
  return (
    unit.status === 'ACTIVE' &&
    !unit.blockedAtHandover &&
    !unit.occupiedAtHandover &&
    ['DONE', 'INSPECTED', 'VERIFIED'].includes(unit.readinessForCurrentRelease ?? '')
  );
}

function earlyFee(time: number, firstNightAmount: number): number {
  if (time < 43_200_000 || time >= 50_400_000) return 0;
  // 30% of integer VND, then CEIL to 1,000 without floating-point intermediates (BR-GEN-03).
  return Number(((BigInt(firstNightAmount) * 30n + 99_999n) / 100_000n) * 1_000n);
}

/**
 * BR-FO-01/02/04/07. No writes/reservations/clock reads; success is a decision, not CHECKED_IN.
 * Caller authenticates approval, loads all current facts and performs final recheck, ledger,
 * status/history/audit in the same locked transaction. Old housekeeping tasks are not evidence.
 */
export function checkIn(input: CheckInInput): Result<CheckInDecision, CheckInFailure> {
  if (!validInput(input))
    return err({ code: 'E_FO_INVALID_INPUT', message: 'Invalid check-in facts' });
  if (input.status !== 'CONFIRMED') return refuse('STATUS');
  const { date, millisecondsSinceMidnight: time } = input.localNow;
  if (date > input.checkInDate || (date === input.checkInDate && time >= 86_340_000))
    return refuse('NO_SHOW_REQUIRED');
  if (date !== input.checkInDate) return refuse('WRONG_DATE');
  if (!input.units.every(ready)) return refuse('UNITS_NOT_READY');
  if (time < 28_800_000) return refuse('ADDITIONAL_NIGHT_REQUIRED');
  if (!approvedDebt(input)) return refuse('DEBT_APPROVAL_REQUIRED');

  return ok({
    earlyCheckInFee: earlyFee(time, input.firstNightAmount),
    approvedDebt: input.balanceDue,
  });
}
