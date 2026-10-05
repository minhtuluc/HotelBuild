import type { CheckInInput } from '../index.js';

export { checkOutFee } from './fees.js';
export interface CheckOutFeeInput {
  readonly checkOutDate: string;
  readonly localNow: CheckInInput['localNow'];
  /** Sum of last-night snapshot prices for the selling units being checked out. */
  readonly lastNightAmount: number;
}
export interface EarlyCheckoutFacts {
  readonly reason: 'EARLY_CHECKOUT';
  readonly actualLocalTime: CheckInInput['localNow'];
  /** Half-open unused stay range; caller loads its prices/policy/notice evidence (BR-CANCEL-09). */
  readonly unusedNightRange: { readonly startDate: string; readonly endDate: string };
}
export interface CheckOutFeeDecision {
  readonly lateCheckOutFee: number;
  readonly lateFeePercent: 0 | 50 | 100;
  readonly earlyCheckout: EarlyCheckoutFacts | null;
}
export type CheckOutFeeFailure = {
  readonly code: 'E_FO_INVALID_INPUT' | 'E_FO_UNSAFE_AMOUNT';
  readonly message: string;
};
