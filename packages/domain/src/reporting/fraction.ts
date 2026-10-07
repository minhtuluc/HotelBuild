import { err, ok } from '../shared/result.js';
import type { Result } from '../shared/result.js';
import type { ExactFraction, FormattedFraction, ReportingFailure } from './index.js';

function validFraction(fraction: ExactFraction | null): boolean {
  return (
    fraction === null ||
    (Boolean(fraction) &&
      typeof fraction.numerator === 'bigint' &&
      typeof fraction.denominator === 'bigint' &&
      fraction.numerator >= 0n &&
      fraction.denominator > 0n)
  );
}
function render(fraction: ExactFraction, decimalPlaces: number, percent: boolean): string {
  const scale = 10n ** BigInt(decimalPlaces);
  const numerator = fraction.numerator * (percent ? 100n : 1n) * scale;
  const rounded = (2n * numerator + fraction.denominator) / (2n * fraction.denominator);
  return decimalPlaces === 0
    ? String(rounded)
    : `${rounded / scale}.${String(rounded % scale).padStart(decimalPlaces, '0')}`;
}

export function formatFraction(
  fraction: ExactFraction | null,
  decimalPlaces = 2,
  percent = false,
): Result<FormattedFraction, ReportingFailure> {
  if (
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 6 ||
    typeof percent !== 'boolean' ||
    !validFraction(fraction)
  )
    return err({ code: 'E_REPORT_INVALID_INPUT', message: 'Invalid fraction presentation' });
  const text = fraction === null ? '—' : render(fraction, decimalPlaces, percent);
  return ok({ text, decimalPlaces, rounding: 'HALF_UP', scale: percent ? 'PERCENT' : 'RATIO' });
}
