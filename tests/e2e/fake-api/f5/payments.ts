import { timingSafeEqual } from 'node:crypto';
import {
  onlinePaymentCreateRequestSchema,
  paymentCreateRequestSchema,
  pinVerifyRequestSchema,
  type Payment,
} from '../../../../packages/contracts/src/index.js';
import type { FakeActor, FakeBooking, FakeRequest, FakeResponse } from '../core/types.js';
import { FixtureState, ended, error, now } from './state.js';
export function settle(state: FixtureState, stored: FakeBooking, payment: Payment) {
  if (payment.status === 'SUCCEEDED') return;
  payment.status = 'SUCCEEDED';
  payment.paidAt = now();
  payment.providerTxnId = `synthetic-psp-${payment.paymentId}`;
  stored.value.paidAmount += payment.amount;
  if (
    ['HELD', 'PENDING_PAYMENT'].includes(stored.value.status) &&
    stored.value.holdExpiresAt &&
    Date.parse(stored.value.holdExpiresAt) <= Date.now()
  )
    stored.value.status = 'EXPIRED';
  if (['CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(stored.value.status))
    state.addRefund(stored, payment, 'synthetic-late-payment-service', 'PAYMENT_TIMEOUT', true);
  else if (
    ['HELD', 'PENDING_PAYMENT'].includes(stored.value.status) &&
    stored.value.paidAmount >= stored.value.depositAmount
  )
    stored.value.status = 'CONFIRMED';
  if (!['CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(stored.value.status)) {
    const surplus = Math.min(
      payment.amount,
      Math.max(
        0,
        stored.value.paidAmount -
          stored.value.refundedAmount -
          state.reserved(stored.value.id) -
          stored.value.totalAmount,
      ),
    );
    if (surplus > 0)
      state.addRefund(stored, payment, 'synthetic-late-payment-service', 'SYSTEM', true, surplus);
  }
  state.updateBalance(stored);
}
export function paymentResponse(
  state: FixtureState,
  request: FakeRequest,
  actor: FakeActor,
): FakeResponse | undefined {
  const path = request.url.pathname;
  if (
    !actor.guest &&
    !state.allowed(actor, ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER', 'ACCOUNTANT'])
  )
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  if (path === '/api/v1/auth/pin/verify' && request.method === 'POST') {
    if (actor.guest) return error(request, 403, 'E_RBAC_FORBIDDEN');
    const parsed = pinVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const bookingId = parsed.data.bookingId;
    if (!bookingId || !state.booking(bookingId, actor))
      return error(request, 404, 'E_GEN_NOT_FOUND');
    if (state.scenarios.get(bookingId) === 'pin-locked')
      return error(request, 403, 'E_AUTH_PIN_LOCKED');
    if (!timingSafeEqual(Buffer.from(parsed.data.pin), Buffer.from('123456')))
      return error(request, 401, 'E_AUTH_PIN_REQUIRED');
    const expires = Date.now() + 300000;
    const pinToken = `synthetic-pin-${crypto.randomUUID()}`;
    state.pins.set(pinToken, { actor: actor.key, bookingId, expires, used: false });
    return { status: 200, body: { pinToken, expiresAt: new Date(expires).toISOString() } };
  }
  const detail = /^\/api\/v1\/payments\/([^/]+)\/status$/.exec(path);
  if (detail && request.method === 'GET') {
    const payment = state.payments.get(decodeURIComponent(detail[1]!));
    if (!payment || !state.booking(payment.bookingId, actor))
      return error(request, 404, 'E_GEN_NOT_FOUND');
    return { status: 200, body: payment };
  }
  const balance = /^\/api\/v1\/bookings\/([^/]+)\/balance$/.exec(path);
  if (balance && request.method === 'GET') {
    const stored = state.booking(decodeURIComponent(balance[1]!), actor);
    return stored
      ? { status: 200, body: state.balance(stored) }
      : error(request, 404, 'E_GEN_NOT_FOUND');
  }
  if (request.method !== 'POST' || !['/api/v1/payments', '/api/v1/payments/online'].includes(path))
    return undefined;
  const online = path.endsWith('/online');
  if (
    online ? !actor.guest : !state.allowed(actor, ['FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT'])
  )
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  const parsed = (online ? onlinePaymentCreateRequestSchema : paymentCreateRequestSchema).safeParse(
    request.body,
  );
  if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
  const input = parsed.data;
  const methods = online ? ['VNPAY', 'MOMO'] : ['CASH', 'BANK_TRANSFER'];
  if (!methods.includes(input.method) || !['DEPOSIT', 'BALANCE'].includes(input.type))
    return error(request, 400, 'E_GEN_VALIDATION_FAILED');
  if (!online && actor.role === 'RESERVATION_AGENT' && input.type !== 'DEPOSIT')
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  const stored = state.booking(input.bookingId, actor);
  if (!stored) return error(request, 404, 'E_GEN_NOT_FOUND');
  return state.idempotent(request, actor, () => {
    const scenario = state.scenarios.get(input.bookingId);
    if (online && ['gateway-error', 'gateway-timeout'].includes(scenario ?? ''))
      return error(
        request,
        scenario === 'gateway-error' ? 502 : 504,
        scenario === 'gateway-error' ? 'E_PAY_GATEWAY_ERROR' : 'E_PAY_GATEWAY_TIMEOUT',
      );
    const pin = online ? undefined : state.pin(request, actor, input.bookingId);
    if (!online && !pin) return error(request, 401, 'E_AUTH_PIN_REQUIRED');
    if (ended.includes(stored.value.status)) return error(request, 409, 'E_BOOK_INVALID_STATE');
    const amount = input.type === 'DEPOSIT' ? stored.value.depositAmount : stored.value.balanceDue;
    if (
      input.amount !== amount ||
      (input.type === 'DEPOSIT' && stored.value.paidAmount >= stored.value.depositAmount)
    )
      return error(request, 422, 'E_PAY_AMOUNT_MISMATCH');
    const id = crypto.randomUUID();
    const payment: Payment = {
      paymentId: id,
      bookingId: input.bookingId,
      type: input.type,
      method: input.method,
      amount: input.amount,
      status: 'PENDING',
      providerTxnId: null,
      paymentUrl: online ? `${request.url.origin}/__test/f5/payments/${id}` : null,
      expiresAt: online ? new Date(Date.now() + 900000).toISOString() : null,
      paidAt: null,
      createdAt: now(),
      createdBy: actor.key,
    };
    state.payments.set(id, payment);
    if (!online) {
      settle(state, stored, payment);
      state.consume(pin!);
    }
    return { status: 201, body: payment };
  });
}
