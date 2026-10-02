import { DomainError } from '../shared/errors.js';
export function fail(code: `E_CANCEL_${string}`, message: string): never {
  throw new DomainError(code, message);
}
export function integer(value: number, label: string, negative = false): void {
  if (!Number.isSafeInteger(value) || (!negative && value < 0))
    fail(
      'E_CANCEL_INVALID_INPUT',
      `${label} must be a ${negative ? '' : 'nonnegative '}safe integer`,
    );
}
export function ids(values: readonly string[], label: string): Set<string> {
  const unique = new Set<string>();
  for (const id of values) {
    if (typeof id !== 'string' || !id.trim() || unique.has(id))
      fail('E_CANCEL_INVALID_INPUT', `${label} contains invalid or duplicate IDs`);
    unique.add(id);
  }
  return unique;
}
export function money(value: bigint): number {
  const amount = Number(value);
  integer(amount, 'Money output');
  return amount;
}
