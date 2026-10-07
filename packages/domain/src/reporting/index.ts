export interface ExactFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}
/** One aggregate per physical room/business night. DOR soldUnits counts beds. */
export interface RoomNightFact {
  readonly roomId: string;
  readonly businessDate: string;
  readonly kind: 'PRIVATE' | 'DOR';
  readonly bedCount: number;
  readonly active: boolean;
  readonly blocked: boolean;
  readonly soldUnits: number;
  /** Settled NET room revenue (BR-RATE-08), not gross revenue or cash collections. */
  readonly netRevenueVnd: number;
}
export interface BookingFact {
  readonly bookingId: string;
  readonly createdOn: string;
  readonly cancelled: boolean;
}
export interface OverbookingCostFact {
  readonly businessDate: string;
  readonly mergeDiscountVnd: number;
  readonly walkOutCompensationVnd: number;
  readonly transportSupportVnd: number;
}
export interface ReportingInput {
  readonly from: string;
  readonly to: string;
  readonly roomNights: readonly RoomNightFact[];
  readonly bookings: readonly BookingFact[];
  readonly overbookingCosts: readonly OverbookingCostFact[];
}
export interface ReportingMetrics {
  readonly soldUnitNights: number;
  readonly availableUnitNights: number;
  readonly netRevenueVnd: number;
  readonly bookingsCreated: number;
  readonly cancelledBookings: number;
  readonly occupancy: ExactFraction | null;
  readonly adr: ExactFraction | null;
  readonly revpar: ExactFraction | null;
  readonly cancellationRate: ExactFraction | null;
  readonly overbookingCost: {
    readonly mergeDiscountVnd: number;
    readonly walkOutCompensationVnd: number;
    readonly transportSupportVnd: number;
    readonly totalVnd: number;
  };
}
export interface ReportingFailure {
  readonly code: 'E_REPORT_INVALID_INPUT' | 'E_REPORT_UNSAFE_TOTAL';
  readonly message: string;
}
export interface FormattedFraction {
  readonly text: string;
  readonly decimalPlaces: number;
  readonly rounding: 'HALF_UP';
  readonly scale: 'RATIO' | 'PERCENT';
}
export { calculateReportingMetrics } from './metrics.js';
export { formatFraction } from './fraction.js';
