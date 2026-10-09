import { test, expect } from 'vitest';
import { lastValueFrom, throwError, of } from 'rxjs';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { authorizeActor } from '../../src/common/actor/authorized-actor.js';
import {
  propertyWhere,
  guestOwnedWhere,
  requireProperty,
  requireScopedResult,
  ScopeDeniedError,
} from '../../src/common/rbac/scope.js';
import { ScopeDenialInterceptor } from '../../src/common/rbac/scope-denial.interceptor.js';
import {
  businessDb,
  registry,
  propertyId,
  otherPropertyId,
  roomId,
  otherRoomId,
  userId,
  guestId,
  otherGuestId,
  rows,
} from './fixture.js';

const actor = (role = 'FRONT_DESK', scope = [propertyId]) =>
  authorizeActor(
    {
      id: userId,
      role,
      ip: null,
      correlationId: 'synthetic-scope',
      sessionId: userId,
      surface: 'OPS_WEB',
      mustChangePassword: false,
    },
    scope,
    registry(),
  );

test('actor methods reflect explicit permissions and chain scope independently', () => {
  const owner = actor('OWNER');
  expect(owner.isOwner()).toBe(true);
  expect(owner.canActOn(otherPropertyId)).toBe(true);
  expect(owner.hasPermission('refund.pay')).toBe(false);
  const sysadmin = actor('SYSADMIN');
  expect(sysadmin.canActOn(propertyId)).toBe(false);
  expect(sysadmin.hasPermission('system.backup')).toBe(true);
  expect(actor().canActOn('')).toBe(false);
  expect(actor().hasPermission('constructor')).toBe(false);
  expect(actor('UNKNOWN').hasPermission('auth.me')).toBe(false);
});
test('actor scope and identity cannot be widened by mutating caller-owned arrays or actor fields', () => {
  const source = [propertyId];
  const scoped = actor('FRONT_DESK', source);
  source.push(otherPropertyId);
  expect(scoped.propertyScope).toEqual([propertyId]);
  expect(scoped.canActOn(otherPropertyId)).toBe(false);
  expect(Object.isFrozen(scoped)).toBe(true);
  expect(Object.isFrozen(scoped.propertyScope)).toBe(true);
  expect(() => Reflect.set(scoped, 'role', 'OWNER')).not.toThrow();
  expect(scoped.role).toBe('FRONT_DESK');
});
test('mandatory SQL scope is ANDed with caller OR filters rather than replaced', async () => {
  const found = await businessDb().rooms.findMany({
    where: propertyWhere(actor(), { OR: [{ id: roomId }, { id: otherRoomId }] }),
    select: { id: true },
  });
  expect(found).toEqual([{ id: roomId }]);
  expect(
    await businessDb().rooms.findMany({ where: propertyWhere(actor('FRONT_DESK', []), {}) }),
  ).toEqual([]);
  expect(
    await businessDb().rooms.findMany({ where: propertyWhere(actor('SYSADMIN'), {}) }),
  ).toEqual([]);
});
test('scope denial distinguishes employee403 from guest404 without exposing resource data', () => {
  expect(() => requireProperty(actor(), otherPropertyId)).toThrow(ScopeDeniedError);
  expect(() => requireScopedResult(null, actor())).toThrow(ScopeDeniedError);
  try {
    requireScopedResult(null, actor());
  } catch (error) {
    expect(error).toMatchObject({ status: 403, code: 'E_AUTH_OUT_OF_SCOPE' });
  }
  expect(() => requireScopedResult(null, { type: 'GUEST', id: guestId })).toThrow(ScopeDeniedError);
  try {
    requireScopedResult(null, { type: 'GUEST', id: guestId });
  } catch (error) {
    expect(error).toMatchObject({ status: 404, code: 'E_GEN_NOT_FOUND' });
  }
  expect(requireScopedResult({ id: roomId }, actor())).toEqual({ id: roomId });
  expect(() => requireProperty(actor('OWNER'), otherPropertyId)).not.toThrow();
});
test('guest ownership is enforced in a real query even when a caller supplies another guest OR', async () => {
  const channel = String(
    (
      await rows(
        "INSERT INTO channels(code,name,multiplier) VALUES('WEB','Synthetic',1) RETURNING id",
      )
    )[0]!.id,
  );
  const policy = String(
    (
      await rows(
        "INSERT INTO cancellation_policies(code,name) VALUES('H014','Synthetic') RETURNING id",
      )
    )[0]!.id,
  );
  const plan = String(
    (
      await rows(
        "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Synthetic',30,$1::uuid) RETURNING id",
        [policy],
      )
    )[0]!.id,
  );
  const type = String(
    (await rows('SELECT room_type_id FROM rooms WHERE id=$1::uuid', [roomId]))[0]!.room_type_id,
  );
  for (const [index, guest] of [guestId, otherGuestId].entries())
    await rows(
      `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,'2026-10-10','2026-10-11',1,30)`,
      [`PH-261009-0000${index + 1}`, guest, propertyId, type, plan, channel],
    );
  const found = await businessDb().bookings.findMany({
    where: guestOwnedWhere(
      { type: 'GUEST', id: guestId },
      { OR: [{ guest_id: guestId }, { guest_id: otherGuestId }] },
    ),
    select: { guest_id: true },
  });
  expect(found).toEqual([{ guest_id: guestId }]);
  expect(() => guestOwnedWhere({ type: 'GUEST', id: '' }, {})).toThrow(ScopeDeniedError);
});
test('scope denial leaves a structured trace event and propagates the original error', async () => {
  const events: Record<string, unknown>[] = [];
  const interceptor = new ScopeDenialInterceptor({
    warn: (event) => {
      events.push(event);
    },
  });
  const context = new ExecutionContextHost([
    { actor: actor(), body: { phone: 'sensitive-must-not-log' } },
  ]);
  const denied = new ScopeDeniedError();
  await expect(
    lastValueFrom(interceptor.intercept(context, { handle: () => throwError(() => denied) })),
  ).rejects.toBe(denied);
  expect(events).toEqual([
    { event: 'RBAC_DENIED', reason: 'SCOPE', correlationId: 'synthetic-scope' },
  ]);
  expect(JSON.stringify(events)).not.toContain('sensitive-must-not-log');
  expect(await lastValueFrom(interceptor.intercept(context, { handle: () => of('allowed') }))).toBe(
    'allowed',
  );
});
