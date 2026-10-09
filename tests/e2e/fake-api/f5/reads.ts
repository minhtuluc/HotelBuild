/** Session-scoped synthetic read models; shared with the mutable F5 booking store. */
import {
  bookingsQuerySchema,
  type GuestSummary,
} from '../../../../packages/contracts/src/index.js';
import type { FakeActor, FakeRequest, FakeResponse } from '../core/types.js';
import { FixtureState, error, now } from './state.js';
export function readResponse(
  state: FixtureState,
  profiles: Map<string, GuestSummary>,
  request: FakeRequest,
  actor: FakeActor,
): FakeResponse | undefined {
  const path = request.url.pathname;
  if (request.method !== 'GET') return undefined;
  if (path === '/api/v1/auth/me') {
    if (actor.guest) return error(request, 403, 'E_RBAC_FORBIDDEN');
    return { status: 200, body: {
      userId: actor.key, username: actor.key, fullName: 'Nhân viên mô phỏng',
      role: actor.role, propertyScope: [...actor.propertyIds],
      hasPin: true, mustChangePassword: false,
    } };
  }
  if (path === '/api/v1/guests/me' || path === '/api/v1/guests/me/loyalty') {
    if (!actor.guest) return error(request, 403, 'E_RBAC_FORBIDDEN');
    let profile = profiles.get(actor.key);
    if (!profile) {
      profile = {
        id: state.context.getGuestId!(actor.key),
        fullName: 'Khách mô phỏng',
        phone: '+84912000000',
        email: null,
        loyaltyTier: 'GUEST',
        loyaltyPoints: 0,
        totalStays: 0,
        blacklisted: false,
        consentMarketing: false,
        createdAt: now(),
      };
      profiles.set(actor.key, profile);
    }
    return {
      status: 200,
      body: path.endsWith('/loyalty')
        ? {
            guestId: profile.id,
            loyaltyTier: profile.loyaltyTier,
            loyaltyPoints: profile.loyaltyPoints,
            staysLast12Months: 0,
            totalStays: profile.totalStays,
            updatedAt: profile.createdAt,
          }
        : profile,
    };
  }
  if (path !== '/api/v1/bookings') return undefined;
  if (!actor.guest && !state.allowed(actor, ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER', 'ACCOUNTANT']))
    return error(request, 403, 'E_RBAC_FORBIDDEN');
  const parsed = bookingsQuerySchema.safeParse(Object.fromEntries(request.url.searchParams));
  if (!parsed.success) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
  const query = parsed.data;
  // No arbitrary sort expression is evaluated by this finite fixture.
  if (query.sort && !['createdAt', '-createdAt'].includes(query.sort))
    return error(request, 400, 'E_GEN_VALIDATION_FAILED');
  const all = (state.context.listBookings?.() ?? [])
    .filter((stored) => state.booking(stored.value.id, actor) !== undefined &&
      (!query.channelCode || stored.channelCode === query.channelCode))
    .map((stored) => stored.value)
    .filter((value) =>
      (!query.propertyId || value.propertyId === query.propertyId) &&
      (!query.status || value.status === query.status) &&
      (!query.from || value.checkIn >= query.from) &&
      (!query.to || value.checkIn <= query.to) &&
      (!query.q || value.code.toLowerCase().includes(query.q.toLowerCase())),
    );
  if (query.sort) all.sort((a, b) => (query.sort === '-createdAt' ? -1 : 1) * a.createdAt.localeCompare(b.createdAt));
  const start = query.cursor ? all.findIndex((value) => value.id === query.cursor) + 1 : 0;
  if (query.cursor && start === 0) return error(request, 400, 'E_GEN_VALIDATION_FAILED');
  const data = all.slice(start, start + query.limit);
  const hasMore = start + data.length < all.length;
  return { status: 200, body: { data, meta: { limit: query.limit, total: all.length, hasMore, nextCursor: hasMore ? data.at(-1)!.id : null } } };
}
