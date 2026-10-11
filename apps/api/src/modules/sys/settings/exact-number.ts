/** Decimal arithmetic before IEEE754 conversion, bounded to at most16 significant integer digits. */
export function exactInteger(value: string): bigint | null {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!parts) return null;
  const fraction = parts[3] ?? '',
    digits = (parts[2]! + fraction).replace(/^0+/, '');
  if (!digits) return 0n;
  const exponent = Number(parts[4] ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > digits.length + fraction.length + 16)
    return null;
  const scale = fraction.length - exponent;
  const integer = integerDigits(digits, scale);
  if (integer === null) return null;
  const result = BigInt(integer) * (parts[1] === '-' ? -1n : 1n);
  return safeIntegerRange(result) ? result : null;
}
function integerDigits(digits: string, scale: number): string | null {
  if (scale <= 0) return digits.length - scale <= 16 ? digits + '0'.repeat(-scale) : null;
  if (scale >= digits.length || /[1-9]/.test(digits.slice(-scale))) return null;
  const result = digits.slice(0, -scale);
  return result.length <= 16 ? result : null;
}
export function integralSetting(key: string): boolean {
  return (
    [
      'refund.feeAmount',
      'pricing.maxDiscountPct',
      'checkInDebtPct',
      'overbooking.transportSupportCap',
      'channel.lowInventoryThreshold',
    ].includes(key) ||
    key.startsWith('deal.threshold.') ||
    key.startsWith('job.')
  );
}

function safeIntegerRange(value: bigint): boolean {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  return value >= -maximum && value <= maximum;
}
