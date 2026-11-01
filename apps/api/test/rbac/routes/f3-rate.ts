import { RequestMethod } from '@nestjs/common';
import type { Oracle } from './types.js';

/** F3 — lịch giá, mùa, gói giá, huỷ, kênh và báo giá đa kênh. */
export function f3Rate(keyed: Oracle): void {
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
}
