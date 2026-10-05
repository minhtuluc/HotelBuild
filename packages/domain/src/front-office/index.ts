export { checkIn } from './check-in.js';
export {
  checkOutFee,
  type CheckOutFeeInput,
  type CheckOutFeeDecision,
  type CheckOutFeeFailure,
  type EarlyCheckoutFacts,
} from './checkout/index.js';

export interface CheckInUnit {
  readonly roomId: string;
  /** Whole room = 0; dorm bed = its positive bed number. */
  readonly bedNo: number;
  readonly status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  readonly blockedAtHandover: boolean;
  readonly occupiedAtHandover: boolean;
  /** Latest task for the CURRENT release; VERIFIED means a checked, recorded readiness fact. */
  readonly readinessForCurrentRelease:
    'DONE' | 'INSPECTED' | 'VERIFIED' | 'PENDING' | 'IN_PROGRESS' | null;
}

/** Authenticated, persisted approval loaded for this booking, with approver/reason/collection deadline. */
export interface DebtApproval {
  readonly bookingId: string;
  readonly amount: number;
  readonly approverRole: string;
}

export interface CheckInInput {
  readonly bookingId: string;
  readonly status: string;
  readonly checkInDate: string;
  /** Caller converts DB time to Vietnamese civil time; this boundary never reads a clock. */
  readonly localNow: {
    readonly date: string;
    readonly millisecondsSinceMidnight: number;
    readonly timeZone: 'Asia/Ho_Chi_Minh';
  };
  readonly totalAmount: number;
  /** Final ledger balance, including all penalties/fees; caller must account for the early fee. */
  readonly balanceDue: number;
  /** Sum of first-night prices for the required selling units, from the booking snapshot. */
  readonly firstNightAmount: number;
  /** Complete required units, scoped/loaded under the caller's transaction and locks (BR-FO-07). */
  readonly units: readonly CheckInUnit[];
  readonly debtApproval: DebtApproval | null;
  /** Loaded SystemSetting values (BR-SYS-02); defaults 5,000,000 VND and 50 percent. */
  readonly managerDebtLimits?: { readonly amount: number; readonly percent: number };
}

export interface CheckInDecision {
  readonly earlyCheckInFee: number;
  readonly approvedDebt: number;
}

export type CheckInFailure =
  | { readonly code: 'E_FO_INVALID_INPUT'; readonly message: string }
  | {
      readonly code: 'E_FO_CHECKIN_NOT_ALLOWED';
      readonly reason:
        | 'STATUS'
        | 'NO_SHOW_REQUIRED'
        | 'WRONG_DATE'
        | 'UNITS_NOT_READY'
        | 'ADDITIONAL_NIGHT_REQUIRED'
        | 'DEBT_APPROVAL_REQUIRED';
    };
