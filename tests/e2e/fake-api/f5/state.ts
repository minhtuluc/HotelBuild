/** Synthetic HTTP state, isolated per startFakeApi instance; not a production ledger. */
import type {
  Payment,
  RefundRequest,
  CancelPreview,
} from '../../../../packages/contracts/src/index.js';
import type {
  FakeActor,
  FakeApiContext,
  FakeBooking,
  FakeRequest,
  FakeResponse,
} from '../core/types.js';
export const now = () => new Date().toISOString();
export const ended = ['CANCELLED', 'NO_SHOW', 'EXPIRED', 'CHECKED_OUT'];
type CancellationBreakdown = CancelPreview['cancellation'];
export function error(request: FakeRequest, status: number, code: string): FakeResponse {
  return {
    status,
    body: {
      code,
      message: 'Synthetic F5 scenario',
      traceId: 'fake-f5-trace',
      timestamp: now(),
      path: request.url.pathname,
    },
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export class FixtureState {
  readonly payments = new Map<string, Payment>();
  readonly refunds = new Map<string, RefundRequest>();
  readonly scenarios = new Map<string, string>();
  readonly deletedBookings = new Map<string, FakeBooking>();
  readonly pins = new Map<
    string,
    { actor: string; bookingId: string; expires: number; used: boolean }
  >();
  private readonly replays = new Map<string, { fingerprint: string; response: FakeResponse }>();
  private readonly cancellationSnapshots = new Map<string, CancellationBreakdown>();
  constructor(readonly context: FakeApiContext) {}
  booking(id: string, actor: FakeActor): FakeBooking | undefined {
    const stored = this.context.getBooking?.(id);
    return stored &&
      (actor.guest
        ? stored.owner === actor.key
        : actor.propertyIds.includes(stored.value.propertyId))
      ? stored
      : undefined;
  }
  deletedBooking(id: string, actor: FakeActor): FakeBooking | undefined {
    const stored = this.deletedBookings.get(id);
    return stored &&
      (actor.guest
        ? stored.owner === actor.key
        : actor.propertyIds.includes(stored.value.propertyId))
      ? stored
      : undefined;
  }
  allowed(actor: FakeActor, roles: FakeActor['role'][]): boolean {
    return !actor.guest && roles.includes(actor.role);
  }
  reserved(id: string, paymentId?: string): number {
    return [...this.refunds.values()]
      .filter((value) => value.bookingId === id && (!paymentId || value.paymentId === paymentId))
      .reduce(
        (sum, value) =>
          sum +
          (value.status === 'PENDING'
            ? value.requestedAmount
            : value.status === 'APPROVED'
              ? (value.approvedAmount ?? 0)
              : 0),
        0,
      );
  }
  refunded(paymentId: string): number {
    return [...this.refunds.values()]
      .filter((value) => value.paymentId === paymentId && value.status === 'PAID')
      .reduce((sum, value) => sum + (value.approvedAmount ?? 0), 0);
  }
  balance(stored: FakeBooking) {
    const value = stored.value;
    return {
      bookingId: value.id,
      currency: 'VND',
      totalAmount: value.totalAmount,
      paidAmount: value.paidAmount,
      refundedAmount: value.refundedAmount,
      reservedRefundAmount: this.reserved(value.id),
      balanceDue: value.balanceDue,
    };
  }
  updateBalance(stored: FakeBooking) {
    stored.value.balanceDue = ended.includes(stored.value.status)
      ? 0
      : Math.max(
          0,
          stored.value.totalAmount - stored.value.paidAmount + stored.value.refundedAmount,
        );
  }
  breakdown(stored: FakeBooking): CancellationBreakdown {
    const prior = this.cancellationSnapshots.get(stored.value.id);
    if (prior) return { ...prior };
    const value = stored.value;
    const early = ['DRAFT', 'HELD', 'PENDING_PAYMENT', 'EXPIRED'].includes(value.status);
    // Literal UI samples from the published tiers, not a policy engine or wall-clock calculation.
    const sample =
      value.ratePlanId === 'SAVER3'
        ? { hours: 96, percent: 100, tier: '72h' }
        : value.ratePlanId === 'LONGSTAY14'
          ? { hours: 200, percent: 50, tier: '168h' }
          : value.ratePlanId === 'NONREF'
            ? { hours: 96, percent: 0, tier: 'catch-all' }
            : { hours: 96, percent: 50, tier: '72h' };
    const percent = early ? 100 : sample.percent;
    return {
      policyId: `synthetic-policy-${value.ratePlanId}`,
      appliedTierId: early ? 'unconfirmed' : `synthetic-${sample.tier}`,
      hoursBeforeCheckIn: sample.hours,
      refundPercent: percent,
      paidAmount: value.paidAmount,
      requestedAmount: early
        ? value.paidAmount
        : Math.floor((value.paidAmount * percent) / 100000) * 1000,
      penaltyAmount: 0,
      refundFee: 0,
    };
  }
  saveCancellation(stored: FakeBooking, snapshot: CancellationBreakdown) {
    this.cancellationSnapshots.set(stored.value.id, { ...snapshot });
  }
  addRefund(
    stored: FakeBooking,
    payment: Payment,
    actor: string,
    reason: RefundRequest['reason'],
    late = false,
    lateAmount = payment.amount,
  ): RefundRequest {
    const snapshot = late
      ? {
          ...this.breakdown(stored),
          refundPercent: 100,
          requestedAmount: lateAmount,
          refundFee: 0,
          appliedTierId: 'late-payment',
        }
      : this.breakdown(stored);
    const value: RefundRequest = {
      id: crypto.randomUUID(),
      bookingId: stored.value.id,
      paymentId: payment.paymentId,
      policyId: snapshot.policyId,
      hoursBeforeCheckIn: snapshot.hoursBeforeCheckIn,
      appliedTierId: snapshot.appliedTierId,
      refundPercent: snapshot.refundPercent,
      requestedAmount: snapshot.requestedAmount,
      approvedAmount: null,
      refundFee: snapshot.refundFee,
      status: 'PENDING',
      isForceMajeure: false,
      reason,
      evidenceRefs: [],
      requestedBy: actor,
      approvedBy: null,
      decidedAt: null,
      paidAt: null,
      createdAt: now(),
    };
    this.refunds.set(value.id, value);
    return value;
  }
  pin(request: FakeRequest, actor: FakeActor, bookingId: string): string | undefined {
    if (
      !request.body ||
      typeof request.body !== 'object' ||
      !('pinToken' in request.body) ||
      typeof request.body.pinToken !== 'string'
    )
      return undefined;
    const value = this.pins.get(request.body.pinToken);
    return value &&
      value.actor === actor.key &&
      value.bookingId === bookingId &&
      value.expires > Date.now() &&
      !value.used
      ? request.body.pinToken
      : undefined;
  }
  consume(pin: string) {
    this.pins.get(pin)!.used = true;
  }
  idempotent(request: FakeRequest, actor: FakeActor, perform: () => FakeResponse): FakeResponse {
    if (
      !request.idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.idempotencyKey,
      )
    )
      return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const key = canonical([
      actor.key,
      actor.guest,
      request.method,
      request.url.pathname,
      request.idempotencyKey,
    ]);
    const fingerprint = canonical([request.body, [...request.url.searchParams.entries()].sort()]);
    const old = this.replays.get(key);
    if (old)
      return old.fingerprint === fingerprint
        ? { ...structuredClone(old.response), headers: { 'idempotency-replayed': 'true' } }
        : error(request, 409, 'E_SYS_IDEMPOTENCY_KEY_REUSED');
    const response = perform();
    if (response.status >= 200 && response.status < 300)
      this.replays.set(key, { fingerprint, response: structuredClone(response) });
    return response;
  }
}
