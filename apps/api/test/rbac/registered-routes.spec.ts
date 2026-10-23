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
interface Expected {
  roles: readonly string[];
  status: number;
  method: RequestMethod;
}
/** `GET` trên id oracle không tồn tại ⇒ 404 trước khi chạm dữ liệu (gọn để tệp oracle không vượt `max-lines`). */
const readMissing = (roles: readonly string[]): Expected => ({
  roles,
  status: 404,
  method: RequestMethod.GET,
});
const GUEST_STAFF = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;
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
  // HB-015 / api.md §2.1, §6.3: PIN — mở khoá (nhân viên tài chính), đặt PIN của mình (mọi nhân viên),
  // xoá PIN theo cơ sở của MANAGER/SYSADMIN. Thân oracle không hợp lệ → 400; người dùng không tồn tại → 404.
  expected['auth/pin/verify'] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER', 'ACCOUNTANT'],
    status: 400,
    method: RequestMethod.POST,
  };
  expected['auth/pin'] = { roles, status: 400, method: RequestMethod.PUT };
  expected['users/:userId/pin'] = {
    roles: ['MANAGER', 'SYSADMIN'],
    status: 404,
    method: RequestMethod.DELETE,
  };
  // HB-096 / api.md §2.6, §6.1: thu tiền tại quầy là tuyến 🔒 PIN của FRONT_DESK/RESERVATION_AGENT
  // (chỉ cọc)/ACCOUNTANT; thân oracle không hợp lệ → 400 trước khi chạm pinToken.
  expected['payments'] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT'],
    status: 400,
    method: RequestMethod.POST,
  };
  // Sources: HB-034 AC2, BR-INV-06 and api.md §2.2; independent of module permissions.
  const keyed = Object.fromEntries(
    Object.entries(expected).map(([path, rule]) => [`${rule.method}:${path}`, rule]),
  );
  keyed[`${RequestMethod.GET}:room-blocks`] = {
    roles: ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  // HB-034 AC2 (BR-INV-06) + HB-144/145 (api.md §2.9): thao tác ghi của quầy — thân oracle hỏng ⇒ 400.
  for (const path of ['room-blocks', 'front-office/check-in', 'front-office/check-out'])
    keyed[`${RequestMethod.POST}:${path}`] = {
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
  // HB-147 / api.md §2.9, §6.3: no-show thủ công là tuyến **FRONT_DESK**; thân oracle không hợp lệ ⇒ 400
  // sau khi qua quyền. Một dòng để giữ file dưới trần 400 dòng của ESLint (`max-lines`).
  // prettier-ignore
  keyed[`${RequestMethod.POST}:front-office/no-show`] = { roles: ['FRONT_DESK'], status: 400, method: RequestMethod.POST };
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
  // HB-162 / api.md §2.12: báo cáo vận hành từ MANAGER, báo cáo tài chính chỉ ACCOUNTANT/OWNER,
  // `force-majeure` chỉ OWNER. Thiếu `from`/`to` → 400 trước khi chạm dữ liệu.
  keyed[`${RequestMethod.GET}:reports/occupancy`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.GET}:reports/adr-revpar`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.GET}:reports/revenue-by-channel`] = {
    roles: ['ACCOUNTANT', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.GET}:reports/cancellations`] = {
    roles: ['ACCOUNTANT', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.GET}:reports/force-majeure`] = {
    roles: ['OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.GET}:reports/overbooking`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  // HB-149 / UC-CRM-01: hồ sơ khách cho quầy lễ tân và điều phối đặt phòng.
  keyed[`${RequestMethod.GET}:guests`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.POST}:guests`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-163: xuất báo cáo trả 202; theo dõi/tải thao tác kiểm quyền người tạo trong service.
  keyed[`${RequestMethod.POST}:reports/export`] = {
    roles: ['ACCOUNTANT', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.GET}:operations/:operationId`] = readMissing(['ACCOUNTANT', 'OWNER']);
  keyed[`${RequestMethod.GET}:operations/:operationId/download`] = readMissing([
    'ACCOUNTANT',
    'OWNER',
  ]);
  // HB-166 / api.md §2.10: CRM quản trị — ẩn danh hoá, hạng/điểm, danh sách đen.
  keyed[`${RequestMethod.POST}:guests/:guestId/anonymize`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-208 / api.md §2.10: đọc hồ sơ theo id (không có hoặc ngoài phạm vi ⇒ 404).
  keyed[`${RequestMethod.GET}:guests/:guestId`] = readMissing(GUEST_STAFF);
  keyed[`${RequestMethod.GET}:guests/:guestId/loyalty`] = readMissing(GUEST_STAFF);
  keyed[`${RequestMethod.POST}:guests/:guestId/blacklist`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.DELETE}:guests/:guestId/blacklist`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 404,
    method: RequestMethod.DELETE,
  };
  // HB-097 / api.md §2.5: xem trước và huỷ booking; thân oracle không hợp lệ → 400.
  keyed[`${RequestMethod.POST}:bookings/:bookingId/cancel-preview`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.POST}:bookings/:bookingId/cancel`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-098 / api.md §2.5, §6.3: đổi ngày (thân oracle thiếu `checkIn`/`checkOut` ⇒ 400) và xoá cứng
  // (`reason` của oracle hợp lệ, `:bookingId` không tồn tại ⇒ 404 trước khi chạm dữ liệu).
  keyed[`${RequestMethod.POST}:bookings/:bookingId/reschedule`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.DELETE}:bookings/:bookingId`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 404,
    method: RequestMethod.DELETE,
  };
  // HB-077 / api.md §2.5, §6.3: xác nhận booking là tuyến FRONT_DESK trở lên, đúng cơ sở;
  // thân oracle thiếu `paymentId` → 400 trước khi tra tài nguyên.
  keyed[`${RequestMethod.POST}:bookings/:bookingId/confirm`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-151 / UC-BOOK-02 + api.md §2.5, §6.3: walk-in tạo booking kênh WALKIN là tuyến nhân viên
  // (`bookings.create`); thân oracle không hợp lệ ⇒ 400 sau khi qua quyền, trước khi chạm dữ liệu.
  keyed[`${RequestMethod.POST}:walk-in`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-099 / api.md §3.6-3.7 + §6.3: hoàn tiền — lập cho quầy/điều phối, quyết định cho MANAGER+,
  // rút cho người tạo/MANAGER+. Thân oracle không hợp lệ → 400 trước khi tra tài nguyên.
  keyed[`${RequestMethod.POST}:refund-requests`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  for (const action of ['approve', 'reject']) {
    keyed[`${RequestMethod.POST}:refund-requests/:refundRequestId/${action}`] = {
      roles: ['MANAGER', 'OWNER'],
      status: 400,
      method: RequestMethod.POST,
    };
  }
  keyed[`${RequestMethod.POST}:refund-requests/:refundRequestId/cancel`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-100 / api.md §2.6, §6.1: chi hoàn là tuyến **ACCOUNTANT**, đúng cơ sở, chỉ hồ sơ APPROVED;
  // thân oracle thiếu `method` ⇒ 400 trước khi chạm tài nguyên.
  keyed[`${RequestMethod.POST}:refund-requests/:refundRequestId/pay`] = {
    roles: ['ACCOUNTANT'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-168 / api.md §2.11: danh sách và gửi lại thông báo (lý do bắt buộc ở thân lệnh).
  keyed[`${RequestMethod.GET}:notifications`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.POST}:notifications/:notificationId/resend`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  for (const path of ['properties', 'room-types', 'rooms'])
    keyed[`${RequestMethod.GET}:${path}`] = {
      roles: ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'],
      status: 200,
      method: RequestMethod.GET,
    };
  for (const path of ['properties/:propertyId', 'room-types/:roomTypeId'])
    keyed[`${RequestMethod.PATCH}:${path}`] = {
      roles: ['OWNER'],
      status: 428,
      method: RequestMethod.PATCH,
    };
  keyed[`${RequestMethod.POST}:room-types`] = {
    roles: ['OWNER'],
    status: 422,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.POST}:rooms`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  keyed[`${RequestMethod.PATCH}:rooms/:roomId`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 428,
    method: RequestMethod.PATCH,
  };
  keyed[`${RequestMethod.PUT}:rooms/:roomId/connecting-room`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 428,
    method: RequestMethod.PUT,
  };
  // Published GETchannels defaults: api.md §2.4, independent of module contribution.
  keyed[`${RequestMethod.GET}:channels`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  //  HB-056 / api.md §2.4 / BR-RATE-07,08,09: báo giá đa kênh chỉ MANAGER+; oracle gửi thân sai → 400.
  keyed[`${RequestMethod.POST}:quotes/multi-channel`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
  // HB-054 / api.md §2.4 + BR-RBAC-02, BR-RBAC-04: lịch giá theo loại phòng và mùa.
  // GET thiếu `from`/`to` → 400 trước khi chạm dữ liệu; thân lệnh của oracle không hợp lệ → 422.
  keyed[`${RequestMethod.GET}:room-types/:roomTypeId/rate-calendar`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.PUT}:room-types/:roomTypeId/rate-calendar`] = {
    roles: ['OWNER'],
    status: 422,
    method: RequestMethod.PUT,
  };
  keyed[`${RequestMethod.GET}:seasons`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  keyed[`${RequestMethod.POST}:seasons`] = {
    roles: ['OWNER'],
    status: 422,
    method: RequestMethod.POST,
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
      const path = `/api/v1/${route.path.replace(':id', roomId).replace(':operationId', roomId).replace(':notificationId', roomId).replace(':guestId', roomId).replace(':roomBlockId', roomId).replace(':ratePlanId', roomId).replace(':policyId', roomId).replace(':taskId', roomId).replace(':key', 'refund.feeAmount').replace(':propertyId', roomId).replace(':refundRequestId', roomId).replace(':bookingId', roomId).replace(':roomTypeId', roomId).replace(':roomId', roomId).replace(':userId', roomId)}`;
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
