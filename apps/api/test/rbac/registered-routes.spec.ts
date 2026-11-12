import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { errorBodySchema } from '@pinehill/contracts';
import { test, expect } from 'vitest';
import { PUBLIC_ROUTE_KEY } from '../../src/common/guards/decorators.js';
import { independentOracle } from './routes/index.js';
import { application, clock, http, login, roles, roomId } from './fixture.js';

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
  return { path: `${prefix}/${path}`.replaceAll(/\/+/g, '/').replaceAll(/^\/|\/$/g, ''), method };
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
      const path = `/api/v1/${route.path.replace(':id', roomId).replace(':operationId', roomId).replace(':notificationId', roomId).replace(':guestId', roomId).replace(':roomBlockId', roomId).replace(':ratePlanId', roomId).replace(':policyId', roomId).replace(':promotionId', roomId).replace(':taskId', roomId).replace(':key', 'refund.feeAmount').replace(':propertyId', roomId).replace(':refundRequestId', roomId).replace(':bookingId', roomId).replace(':roomTypeId', roomId).replace(':roomId', roomId).replace(':userId', roomId)}`;
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
