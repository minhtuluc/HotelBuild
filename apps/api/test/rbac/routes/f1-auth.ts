import { RequestMethod } from '@nestjs/common';
import { matrix, roles } from '../fixture.js';
import type { Expected, Oracle } from './types.js';

/** F1 — ma trận RBAC, phiên, PIN và thu tiền tại quầy. */
export function f1Auth(oracle: Oracle): void {
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
  const keyed = Object.fromEntries(
    Object.entries(expected).map(([path, rule]) => [`${rule.method}:${path}`, rule]),
  );
  // HB-016 / api.md §2.1, §6.3: người dùng nội bộ (đọc MANAGER+, ghi OWNER/SYSADMIN; thiếu If-Match ⇒ 428). Một dòng: trần max-lines.
  // prettier-ignore
  Object.assign(keyed, { [`${RequestMethod.GET}:users`]: { roles: ['MANAGER', 'OWNER', 'SYSADMIN'], status: 200, method: RequestMethod.GET }, [`${RequestMethod.POST}:users`]: { roles: ['OWNER', 'SYSADMIN'], status: 400, method: RequestMethod.POST }, [`${RequestMethod.PUT}:users/:userId/access`]: { roles: ['OWNER', 'SYSADMIN'], status: 428, method: RequestMethod.PUT } });
  Object.assign(oracle, keyed);
}
