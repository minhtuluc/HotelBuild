import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { errorBodySchema } from '@pinehill/contracts';
import { test, expect } from 'vitest';
import { PUBLIC_ROUTE_KEY } from '../../src/common/guards/decorators.js';
import { application, clock, http, login, matrix, roles, roomId } from './fixture.js';

interface Route {
  path: string;
  method: RequestMethod;
}
function protectedRoutes(): Route[] {
  const app = application();
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: Route[] = [];
  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    const controller = wrapper.metatype;
    if (!controller) continue;
    const prototype: unknown = controller.prototype;
    if (typeof prototype !== 'object' || prototype === null) throw new Error('Invalid controller');
    for (const name of scanner.getAllMethodNames(prototype)) {
      const route = handlerRoute(controller, prototype, name, reflector);
      if (route) routes.push(route);
    }
  }
  return routes;
}
function handlerRoute(
  controller: Function,
  prototype: object,
  name: string,
  reflector: Reflector,
): Route | undefined {
  const handler: unknown = Reflect.get(prototype, name);
  if (typeof handler !== 'function') return;
  const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
  if (method === undefined) return;
  if (reflector.getAllAndOverride(PUBLIC_ROUTE_KEY, [handler, controller]) === true) return;
  const prefix: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
  if (typeof prefix !== 'string' || typeof path !== 'string') throw new Error('Uncovered path');
  if (!supportedMethod(method)) throw new Error('Uncovered HTTP method');
  return { path: `${prefix}/${path}`.replaceAll(/\/+$/g, ''), method };
}
function supportedMethod(value: unknown): value is RequestMethod {
  return (
    value === RequestMethod.GET ||
    value === RequestMethod.POST ||
    value === RequestMethod.DELETE ||
    value === RequestMethod.PUT ||
    value === RequestMethod.PATCH
  );
}
interface Expected {
  roles: readonly string[];
  status: number;
  method: RequestMethod;
}
function independentOracle(): Record<string, Expected> {
  const expected: Record<string, Expected> = {};
  for (const [operation, allowed] of Object.entries(matrix))
    expected[`rbac/${operation}`] = { roles: allowed, status: 201, method: RequestMethod.POST };
  for (const resource of ['bookings', 'payments', 'refunds', 'holds', 'exports'])
    expected[`rbac/${resource}/:id`] = {
      roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
      status: 200,
      method: RequestMethod.GET,
    };
  expected['auth/me'] = { roles, status: 200, method: RequestMethod.GET };
  expected['auth/logout'] = { roles, status: 204, method: RequestMethod.POST };
  // Valid authentication/permission must reach input validation; password behavior has locked tests.
  expected['auth/password'] = { roles, status: 400, method: RequestMethod.POST };
  // Sources: HB-034 AC2, BR-INV-06 and api.md §2.2; independent of module permissions.
  const keyed = Object.fromEntries(
    Object.entries(expected).map(([path, rule]) => [`${rule.method}:${path}`, rule]),
  );
  keyed[`${RequestMethod.GET}:room-blocks`] = {
    roles: ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.POST}:room-blocks`] = {
    roles: ['FRONT_DESK', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.DELETE}:room-blocks/:roomBlockId`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 404,
    method: RequestMethod.DELETE,
  };
  // HB-057 / BR-RATE-20 / api.md §2.4: only OWNER sees or changes global configuration.
  for (const path of ['rate-plans/admin', 'cancellation-policies'])
    keyed[`${RequestMethod.GET}:${path}`] = {
      roles: ['OWNER'],
      status: 200,
      method: RequestMethod.GET,
    };
  for (const path of ['rate-plans/:ratePlanId', 'cancellation-policies/:policyId'])
    keyed[`${RequestMethod.PUT}:${path}`] = {
      roles: ['OWNER'],
      status: 428,
      method: RequestMethod.PUT,
    };
  // HB-035 AC4 / api.md §2.3: independent roles, not imported module configuration.
  keyed[`${RequestMethod.GET}:inventory/grid`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.GET}:channel-allotments`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.PUT}:channel-allotments`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 428,
    method: RequestMethod.PUT,
  };
  keyed[`${RequestMethod.GET}:housekeeping/tasks`] = {
    roles: ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.PATCH}:housekeeping/tasks/:taskId`] = {
    roles: ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER'],
    status: 428,
    method: RequestMethod.PATCH,
  };
  // HB-036 / UC-SYS-01,02: explicit grants, independent of route permission providers.
  keyed[`${RequestMethod.GET}:audit-logs`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.GET}:system-settings`] = {
    roles: ['OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.PUT}:system-settings/:key`] = {
    roles: ['OWNER'],
    status: 428,
    method: RequestMethod.PUT,
  };
  return keyed;
}

function routeRequest(method: RequestMethod, path: string) {
  if (method === RequestMethod.GET) return http().get(path);
  if (method === RequestMethod.DELETE)
    return http().delete(path).query({ reason: 'Synthetic oracle removal' });
  if (method === RequestMethod.PUT) return http().put(path);
  if (method === RequestMethod.PATCH) return http().patch(path);
  return http().post(path);
}

test('every discovered protected HTTP route has an independent oracle and runs against all seven roles', async () => {
  const routes = protectedRoutes();
  const oracle = independentOracle();
  expect(routes.map(({ path, method }) => `${method}:${path}`).sort()).toEqual(
    Object.keys(oracle).sort(),
  );
  let checked = 0;
  for (const route of routes) {
    const expected = oracle[`${route.method}:${route.path}`]!;
    expect(route.method).toBe(expected.method);
    for (const role of roles) {
      clock.value += 61000;
      const token = await login(role);
      const path = `/api/v1/${route.path.replace(':id', roomId).replace(':roomBlockId', roomId).replace(':ratePlanId', roomId).replace(':policyId', roomId).replace(':taskId', roomId).replace(':key', 'refund.feeAmount')}`;
      const pending = routeRequest(route.method, path);
      const result = await pending
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ role: 'OWNER', propertyScope: ['untrusted-body-scope'] });
      const allowed = expected.roles.includes(role);
      expect(result.status, `${role} ${route.path}`).toBe(allowed ? expected.status : 403);
      if (!allowed) expect(errorBodySchema.parse(result.body).code).toBe('E_RBAC_FORBIDDEN');
      if (allowed && route.path === 'auth/password')
        expect(errorBodySchema.parse(result.body).code).toBe('E_GEN_VALIDATION_FAILED');
      checked++;
    }
  }
  expect(checked).toBe(routes.length * 7);
}, 60000);
