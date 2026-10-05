import { err, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';
import type { CheckOutFeeInput, CheckOutFeeDecision, CheckOutFeeFailure } from './index.js';
import { validInput } from './validation.js';

function percentage(input: CheckOutFeeInput): 0 | 50 | 100 {
  const { date, millisecondsSinceMidnight: time } = input.localNow;
  if (date < input.checkOutDate) return 0;
  if (date > input.checkOutDate || time > 64_800_000) return 100;
  return time >= 43_200_000 ? 50 : 0;
}

/**
 * BR-FO-03 quote only. Caller must settle final balance/PIN/auth and release units under TX
 * (BR-FO-05); this decision never prints invoices, changes status or computes early refunds.
 * HB-053's early-checkout integration needs snapshot unused-night prices and notice evidence.
 */
export function checkOutFee(
  input: CheckOutFeeInput,
): Result<CheckOutFeeDecision, CheckOutFeeFailure> {
  if (!validInput(input))
    return err({ code: 'E_FO_INVALID_INPUT', message: 'Invalid checkout facts' });
  const lateFeePercent = percentage(input);
  const fee =
    ((BigInt(input.lastNightAmount) * BigInt(lateFeePercent) + 99_999n) / 100_000n) * 1_000n;
  if (fee > BigInt(Number.MAX_SAFE_INTEGER))
    return err({ code: 'E_FO_UNSAFE_AMOUNT', message: 'Rounded fee exceeds safe integer VND' });
  return ok({
    lateFeePercent,
    lateCheckOutFee: Number(fee),
    earlyCheckout:
      input.localNow.date < input.checkOutDate
        ? {
            reason: 'EARLY_CHECKOUT',
            actualLocalTime: { ...input.localNow },
            unusedNightRange: { startDate: input.localNow.date, endDate: input.checkOutDate },
          }
        : null,
  });
}
