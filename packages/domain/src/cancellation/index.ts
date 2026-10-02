export interface CancellationTier {
  readonly offsetHours: number;
  readonly refundPercent: number;
  readonly chargeFirstNight: boolean;
}
export interface CancellationPolicy {
  readonly tiers: readonly CancellationTier[];
}
export interface RoomWeight {
  readonly bookingRoomId: string;
  readonly weight: number;
}
export interface RoomAllocation {
  readonly bookingRoomId: string;
  readonly amount: number;
}
export interface PaymentInput {
  readonly paymentId: string;
  readonly amount: number;
  readonly weights: readonly RoomWeight[];
}
export interface AllocatedPayment extends PaymentInput {
  readonly allocations: readonly RoomAllocation[];
  readonly processedRoomIds: readonly string[];
}
export interface CancellationInput {
  readonly state: 'CONFIRMED';
  readonly policy: CancellationPolicy;
  /** Nominal check-in instant in integer milliseconds, computed by the caller (including timezone). */
  readonly checkInDateTime: number;
  /** Cancellation decision instant in integer milliseconds on the same timeline as checkInDateTime. */
  readonly now: number;
  readonly rooms: readonly { readonly bookingRoomId: string; readonly firstNightPrice: number }[];
  readonly cancelledRoomIds: readonly string[];
  readonly processedRoomIds: readonly string[];
  readonly payments: readonly AllocatedPayment[];
}
/** State before an expiry or customer withdrawal is committed; terminal states are not accepted. */
export interface PreconfirmationCancellationInput extends Omit<CancellationInput, 'state'> {
  readonly state: 'HELD' | 'PENDING_PAYMENT';
}
export type CancellationRequest = CancellationInput | PreconfirmationCancellationInput;
export interface CancellationDecision {
  readonly refundMode: 'POLICY';
  readonly tier: CancellationTier;
  readonly refundBase: number;
  readonly refundAmount: number;
  readonly penaltyAmount: number;
  readonly payments: readonly AllocatedPayment[];
  readonly processedRoomIds: readonly string[];
  readonly remainingRoomIds: readonly string[];
}
/** No cancellation policy tier applies to money collected before confirmation. */
export interface PreconfirmationCancellationDecision extends Omit<
  CancellationDecision,
  'tier' | 'refundMode'
> {
  readonly refundMode: 'PRECONFIRMATION';
  readonly tier: null;
}
export type CancellationResult = CancellationDecision | PreconfirmationCancellationDecision;
export { allocatePayment } from './allocation.js';
export { resolveTier } from './policy.js';
export { calculateCancellation } from './calculate.js';
