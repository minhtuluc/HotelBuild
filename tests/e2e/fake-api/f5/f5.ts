/** Test-only finite scenarios. Real PSP callback routes intentionally remain absent. */
import { userRoleSchema } from '../../../../packages/contracts/src/index.js';
import type {
  FakeApiContext,
  FakeHandler,
  FakeRequest,
  FakeActor,
  FakeResponse,
} from '../core/types.js';
import { FixtureState, error, now } from './state.js';
import { paymentResponse, settle } from './payments.js';
import { refundResponse } from './refunds.js';
import { readResponse } from './reads.js';
import type { GuestSummary } from '../../../../packages/contracts/src/index.js';
import { bookingResponse } from './bookings.js';
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const events = [
  'payment-success',
  'payment-failed',
  'payment-timeout',
  'expire',
  'cancel',
  'no-show',
  'gateway-error',
  'gateway-timeout',
  'clear-error',
  'pin-locked',
  'reschedule-conflict',
  'unconfirmed-partial',
  'hold-boundary',
  'refund-fee-sample',
];
function control(state: FixtureState, request: FakeRequest, actor: FakeActor): FakeResponse {
  if (request.method !== 'POST') return error(request, 405, 'E_GEN_VALIDATION_FAILED');
  if (request.url.pathname === '/__control/f5/actor') {
    const body = request.body;
    if (!record(body) || Object.keys(body).some((key) => !['role', 'propertyIds'].includes(key)))
      return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const role = userRoleSchema.safeParse(body.role);
    if (
      !role.success ||
      !Array.isArray(body.propertyIds) ||
      body.propertyIds.length > 20 ||
      !body.propertyIds.every(
        (value: unknown): value is string => typeof value === 'string' && value.length > 0,
      )
    )
      return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    if (actor.guest) return error(request, 403, 'E_RBAC_FORBIDDEN');
    state.context.configureActor?.(actor.key, role.data, body.propertyIds);
    return { status: 200, body: { configured: true } };
  }
  const match = /^\/__control\/f5\/bookings\/([^/]+)$/.exec(request.url.pathname);
  if (!match) return error(request, 404, 'E_GEN_NOT_FOUND');
  const stored = state.booking(decodeURIComponent(match[1]!), actor);
  if (!stored) return error(request, 404, 'E_GEN_NOT_FOUND');
  const body = request.body;
  if (
    !record(body) ||
    Object.keys(body).some((key) => !['event', 'paymentId'].includes(key)) ||
    typeof body.event !== 'string' ||
    !events.includes(body.event) ||
    (body.paymentId !== undefined && (typeof body.paymentId !== 'string' || !body.paymentId))
  )
    return error(request, 400, 'E_GEN_VALIDATION_FAILED');
  const { event, paymentId } = body;
  if (event.startsWith('payment-')) {
    const payment = typeof paymentId === 'string' ? state.payments.get(paymentId) : undefined;
    if (!payment || payment.bookingId !== stored.value.id)
      return error(request, 404, 'E_GEN_NOT_FOUND');
    if (event === 'payment-success') settle(state, stored, payment);
    else if (payment.status !== 'SUCCEEDED') {
      payment.status = 'FAILED';
      if (
        event === 'payment-timeout' &&
        ['HELD', 'PENDING_PAYMENT'].includes(stored.value.status) &&
        stored.value.holdExpiresAt !== null &&
        Date.parse(stored.value.holdExpiresAt) <= Date.now()
      ) {
        stored.value.status = 'EXPIRED';
        state.updateBalance(stored);
      }
    }
  } else if (['expire', 'cancel', 'no-show'].includes(event)) {
    stored.value.status =
      event === 'expire' ? 'EXPIRED' : event === 'cancel' ? 'CANCELLED' : 'NO_SHOW';
    state.updateBalance(stored);
  } else if (event === 'unconfirmed-partial') {
    if (
      state.payments.size &&
      [...state.payments.values()].some((value) => value.bookingId === stored.value.id)
    )
      return error(request, 409, 'E_BOOK_INVALID_STATE');
    const id = crypto.randomUUID();
    state.payments.set(id, {
      paymentId: id,
      bookingId: stored.value.id,
      type: 'DEPOSIT',
      method: 'CASH',
      amount: 250499,
      status: 'SUCCEEDED',
      providerTxnId: null,
      paymentUrl: null,
      expiresAt: null,
      paidAt: now(),
      createdAt: now(),
    });
    stored.value.payments = [...state.payments.values()].filter(p => p.bookingId === stored.value.id);
    stored.value.paidAmount = 250499;
    state.updateBalance(stored);
    return { status: 200, body: { paymentId: id } };
  } else if (event === 'refund-fee-sample') {
    state.saveCancellation(stored, { ...state.breakdown(stored), refundFee: 10000 });
  } else if (event === 'hold-boundary') stored.value.holdExpiresAt = now();
  else if (event === 'clear-error') state.scenarios.delete(stored.value.id);
  else state.scenarios.set(stored.value.id, event);
  return { status: 200, body: { event } };
}
export function createHandler(context: FakeApiContext): FakeHandler {
  const state = new FixtureState(context);
  const profiles = new Map<string, GuestSummary>();
  return (request) => {
    const path = request.url.pathname;
    if (/^\/__test\/f5\/payments\/[^/]+$/.test(path) && request.method === 'GET')
      return { status: 200, body: { fixture: true, settled: false } };
    if (
      !path.startsWith('/__control/f5/') &&
      !/^\/api\/v1\/(payments(?:\/|$)|refund-requests(?:\/|$)|bookings(?:\/|$)|guests\/me(?:\/loyalty)?$|auth\/(?:me|pin\/verify)$)/.test(
        path,
      )
    )
      return undefined;
    const actor = context.authenticateActor?.(request.authorization);
    if (!actor) return error(request, 401, 'E_AUTH_INVALID_CREDENTIALS');
    if (path.startsWith('/__control/f5/')) return control(state, request, actor);
    return (
      readResponse(state, profiles, request, actor) ??
      paymentResponse(state, request, actor) ??
      refundResponse(state, request, actor) ??
      bookingResponse(state, request, actor)
    );
  };
}
