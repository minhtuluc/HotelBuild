import {
  refundRequestCreateRequestSchema,
  refundApproveRequestSchema,
  refundRejectRequestSchema,
  refundCancelRequestSchema,
  refundPayRequestSchema,
  refundListQuerySchema,
} from '../../../../packages/contracts/src/index.js';
import type { FakeActor, FakeRequest, FakeResponse } from '../core/types.js';
import { FixtureState, error, now } from './state.js';
export function refundResponse(
  state: FixtureState,
  request: FakeRequest,
  actor: FakeActor,
): FakeResponse | undefined {
  const path = request.url.pathname;
  if (path === '/api/v1/refund-requests' && request.method === 'GET') {
    const parsed = refundListQuerySchema.safeParse(Object.fromEntries(request.url.searchParams));
    if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const query = parsed.data;
    if (
      !actor.guest &&
      !state.allowed(actor, ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER', 'ACCOUNTANT'])
    )
      return error(request, 403, 'E_RBAC_FORBIDDEN');
    const all = [...state.refunds.values()].filter((value) => {
      const stored = state.booking(value.bookingId, actor);
      return (
        stored &&
        (!query.bookingId || value.bookingId === query.bookingId) &&
        (!query.propertyId || stored.value.propertyId === query.propertyId) &&
        (!query.status || value.status === query.status)
      );
    });
    const start = query.cursor ? all.findIndex((value) => value.id === query.cursor) + 1 : 0;
    if (query.cursor && start === 0) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const data = all.slice(start, start + query.limit);
    const hasMore = start + data.length < all.length;
    return {
      status: 200,
      body: {
        data,
        meta: {
          limit: query.limit,
          total: all.length,
          hasMore,
          nextCursor: hasMore ? data.at(-1)!.id : null,
        },
      },
    };
  }
  if (path === '/api/v1/refund-requests' && request.method === 'POST') {
    if (!state.allowed(actor, ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER']))
      return error(request, 403, 'E_RBAC_FORBIDDEN');
    const parsed = refundRequestCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const input = parsed.data;
    const stored = state.booking(input.bookingId, actor);
    const payment = state.payments.get(input.paymentId);
    if (!stored || !payment || payment.bookingId !== input.bookingId)
      return error(request, 404, 'E_GEN_NOT_FOUND');
    return state.idempotent(request, actor, () => {
      // Unsupported special-policy scenarios fail closed rather than inventing a policy oracle.
      if (input.isForceMajeure || input.reason === 'FORCE_MAJEURE')
        return error(request, 403, 'E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN');
      if (input.reason !== 'GUEST_REQUEST') return error(request, 400, 'E_GEN_VALIDATION_FAILED');
      const requested = state.breakdown(stored).requestedAmount;
      if (
        payment.status !== 'SUCCEEDED' ||
        requested <= 0 ||
        requested +
          state.reserved(input.bookingId, payment.paymentId) +
          state.refunded(payment.paymentId) >
          payment.amount
      )
        return error(request, 422, 'E_PAY_REFUND_EXCEEDS_PAID');
      const value = state.addRefund(stored, payment, actor.key, input.reason);
      value.evidenceRefs = input.evidenceRefs ?? [];
      return { status: 201, body: value };
    });
  }
  const detail = /^\/api\/v1\/refund-requests\/([^/]+)\/(approve|reject|cancel|pay)$/.exec(path);
  if (!detail || request.method !== 'POST') return undefined;
  const action = detail[2]!;
  const value = state.refunds.get(decodeURIComponent(detail[1]!));
  const roles = action === 'pay' ? (['ACCOUNTANT'] as const) : (['MANAGER', 'OWNER'] as const);
  if (action !== 'cancel' && !state.allowed(actor, [...roles]))
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  if (!value || !state.booking(value.bookingId, actor))
    return error(request, 404, 'E_GEN_NOT_FOUND');
  if (
    action === 'cancel' &&
    value.requestedBy !== actor.key &&
    !state.allowed(actor, ['MANAGER', 'OWNER'])
  )
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  return state.idempotent(request, actor, () => {
    const schema =
      action === 'approve'
        ? refundApproveRequestSchema
        : action === 'reject'
          ? refundRejectRequestSchema
          : action === 'cancel'
            ? refundCancelRequestSchema
            : refundPayRequestSchema;
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
    const input = parsed.data;
    const pin = action === 'cancel' ? undefined : state.pin(request, actor, value.bookingId);
    if (action !== 'cancel' && !pin) return error(request, 401, 'E_AUTH_PIN_REQUIRED');
    if (action === 'pay' ? value.status !== 'APPROVED' : value.status !== 'PENDING')
      return error(
        request,
        409,
        action === 'pay' ? 'E_PAY_REFUND_NOT_APPROVED' : 'E_PAY_REFUND_NOT_PENDING',
      );
    if (action === 'approve' || action === 'reject') {
      if (value.requestedBy === actor.key) return error(request, 403, 'E_PAY_SELF_APPROVAL');
      if (action === 'approve' && 'approvedAmount' in input) {
        if (input.approvedAmount > value.requestedAmount)
          return error(request, 422, 'E_PAY_AMOUNT_MISMATCH');
        if (
          input.approvedAmount < value.requestedAmount &&
          (!('note' in input) || !input.note?.trim())
        )
          return error(request, 400, 'E_PAY_REASON_TOO_SHORT');
        value.approvedAmount = input.approvedAmount;
      }
      value.status = action === 'approve' ? 'APPROVED' : 'REJECTED';
      value.approvedBy = actor.key;
      value.decidedAt = now();
      state.consume(pin!);
      if (action === 'approve')
        return {
          status: 200,
          body: {
            id: value.id,
            status: value.status,
            requestedAmount: value.requestedAmount,
            approvedAmount: value.approvedAmount,
            refundPercent: value.refundPercent,
            requestedBy: value.requestedBy,
            approvedBy: value.approvedBy,
            decidedAt: value.decidedAt,
            auditLogId: `synthetic-audit-${crypto.randomUUID()}`,
            payoutDeadline: new Date(Date.now() + 604800000).toISOString(),
          },
        };
    } else if (action === 'cancel') value.status = 'CANCELLED';
    else if ('method' in input) {
      const payment = state.payments.get(value.paymentId)!;
      const expected = payment.method === 'CASH' ? 'BANK_TRANSFER' : payment.method;
      if (input.method !== expected) return error(request, 422, 'E_PAY_AMOUNT_MISMATCH');
      if (payment.method === 'CASH' && !input.bankNote?.trim())
        return error(request, 400, 'E_PAY_REASON_TOO_SHORT');
      value.status = 'PAID';
      value.paidAt = now();
      state.consume(pin!);
      const stored = state.booking(value.bookingId, actor)!;
      stored.value.refundedAmount += value.approvedAmount ?? 0;
      state.updateBalance(stored);
    }
    return { status: 200, body: value };
  });
}
