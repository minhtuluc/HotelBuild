import {
  bookingDeleteQuerySchema,
  cancelPreviewRequestSchema,
  cancelRequestSchema,
  rescheduleRequestSchema,
} from '../../../../packages/contracts/src/index.js';
import type { FakeActor, FakeRequest, FakeResponse } from '../core/types.js';
import { dates } from '../journey/fixtures.js';
import { FixtureState, error, now } from './state.js';
export function bookingResponse(
  state: FixtureState,
  request: FakeRequest,
  actor: FakeActor,
): FakeResponse | undefined {
  const match = /^\/api\/v1\/bookings\/([^/]+)(?:\/(cancel-preview|cancel|reschedule))?$/.exec(
    request.url.pathname,
  );
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]!);
  const action = match[2];
  if (request.method === 'DELETE' && !state.allowed(actor, ['FRONT_DESK']))
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  if (
    !actor.guest &&
    !state.allowed(
      actor,
      action || request.method === 'DELETE'
        ? ['FRONT_DESK', 'RESERVATION_AGENT']
        : ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER', 'ACCOUNTANT'],
    )
  )
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  const stored =
    state.booking(id, actor) ??
    (request.method === 'DELETE' ? state.deletedBooking(id, actor) : undefined);
  if (!stored) return error(request, 404, 'E_GEN_NOT_FOUND');
  if (!action && request.method === 'GET') return { status: 200, body: stored.value };
  if (!action && request.method === 'DELETE')
    return state.idempotent(request, actor, () => {
      if (state.deletedBookings.has(id)) return error(request, 404, 'E_GEN_NOT_FOUND');
      const parsed = bookingDeleteQuerySchema.safeParse(
        Object.fromEntries(request.url.searchParams),
      );
      if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
      if (
        !['DRAFT', 'HELD'].includes(stored.value.status) ||
        [...state.payments.values()].some((value) => value.bookingId === id)
      )
        return error(request, 409, 'E_BOOK_HARD_DELETE_FORBIDDEN');
      state.deletedBookings.set(id, structuredClone(stored));
      state.context.deleteBooking?.(id);
      return { status: 204 };
    });
  if (request.method !== 'POST' || !action) return undefined;
  return state.idempotent(request, actor, () => {
    if (action === 'reschedule') {
      const parsed = rescheduleRequestSchema.safeParse(request.body);
      if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
      let nights: number;
      try {
        nights = dates(parsed.data.checkIn, parsed.data.checkOut).length;
      } catch {
        return error(request, 422, 'E_BOOK_INVALID_DATES');
      }
      if (
        !['HELD', 'PENDING_PAYMENT', 'CONFIRMED'].includes(stored.value.status) ||
        stored.value.rescheduleCount > 0 ||
        stored.value.ratePlanId === 'NONREF'
      )
        return error(request, 409, 'E_BOOK_INVALID_STATE');
      if (state.scenarios.get(id) === 'reschedule-conflict')
        return error(request, 409, 'E_INV_ROOM_TAKEN');
      // Frozen synthetic rate; preserve the old commitment/deposit, never create refund on reschedule.
      stored.value = {
        ...stored.value,
        checkIn: parsed.data.checkIn,
        checkOut: parsed.data.checkOut,
        nights,
        totalAmount: Math.max(stored.value.totalAmount, nights * 1000000 * stored.value.roomCount),
        rescheduleCount: stored.value.rescheduleCount + 1,
      };
      state.updateBalance(stored);
      return { status: 200, body: stored.value };
    }
    const parsed = (
      action === 'cancel-preview' ? cancelPreviewRequestSchema : cancelRequestSchema
    ).safeParse(request.body);
    if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const input = parsed.data;
    if (input.isForceMajeure || input.reason !== 'GUEST_REQUEST')
      return error(request, 403, 'E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN');
    if (
      'bookingRoomIds' in input &&
      Array.isArray(input.bookingRoomIds) &&
      input.bookingRoomIds.length
    )
      return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    if (!['DRAFT', 'HELD', 'PENDING_PAYMENT', 'CONFIRMED'].includes(stored.value.status))
      return error(request, 409, 'E_CANCEL_NOT_ALLOWED');
    const cancellation = state.breakdown(stored);
    if (action === 'cancel-preview')
      return { status: 200, body: { bookingId: id, currency: 'VND', cancellation, warnings: [] } };
    const payments = [...state.payments.values()].filter(
      (value) => value.bookingId === id && value.status === 'SUCCEEDED',
    );
    // This scenario suite supplies one payment for ordinary cancel; multi-allocation belongs to real backend tests.
    if (payments.length > 1 || state.reserved(id) > 0)
      return error(request, 409, 'E_CANCEL_NOT_ALLOWED');
    const payment = payments[0];
    if (
      payment &&
      cancellation.requestedAmount + state.refunded(payment.paymentId) > payment.amount
    )
      return error(request, 422, 'E_PAY_REFUND_EXCEEDS_PAID');
    const refund =
      payment && cancellation.requestedAmount > 0
        ? state.addRefund(stored, payment, actor.key, input.reason)
        : undefined;
    state.saveCancellation(stored, cancellation);
    stored.value.status = 'CANCELLED';
    state.updateBalance(stored);
    return {
      status: 200,
      body: {
        bookingId: id,
        status: stored.value.status,
        cancelledAt: now(),
        cancelReason: input.reason,
        releasedAssignmentCount: stored.value.roomCount,
        cancellation,
        refundRequest: refund
          ? { id: refund.id, status: refund.status, approvedAmount: refund.approvedAmount }
          : null,
      },
    };
  });
}
