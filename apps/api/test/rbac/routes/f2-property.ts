import { RequestMethod } from '@nestjs/common';
import type { Oracle } from './types.js';

/** F2 — cơ sở, loại phòng, phòng, khoá phòng, tồn, allotment, buồng phòng, tham số hệ thống. */
export function f2Property(keyed: Oracle): void {
  // Sources: HB-034 AC2, BR-INV-06 and api.md §2.2; independent of module permissions.
  keyed[`${RequestMethod.GET}:room-blocks`] = {
    roles: ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'],
    status: 200,
    method: RequestMethod.GET,
  };
  // HB-034 AC2 (BR-INV-06) + HB-144/145 (api.md §2.9): thao tác ghi của quầy — thân oracle hỏng ⇒ 400.
  // HB-209: cùng tập vai trò cho `check-out/preview`; một dòng để giữ file dưới trần `max-lines`.
  // prettier-ignore
  for (const path of ['room-blocks', 'front-office/check-in', 'front-office/check-out', 'front-office/check-out/preview'])
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
  keyed[`${RequestMethod.GET}:inventory/grid`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.GET,
  };
  // HB-244: ảnh công khai. Oracle thay `:propertyId`/`:roomTypeId` bằng UUID không phải cơ sở/loại phòng
  // ⇒ vai trò được phép đọc nhận 404; PUT không gửi If-Match ⇒ 428 (chỉ OWNER).
  for (const owner of ['properties/:propertyId', 'room-types/:roomTypeId']) {
    keyed[`${RequestMethod.GET}:${owner}/photos`] = {
      roles: ['MANAGER', 'OWNER'],
      status: 404,
      method: RequestMethod.GET,
    };
    keyed[`${RequestMethod.PUT}:${owner}/photos`] = {
      roles: ['OWNER'],
      status: 428,
      method: RequestMethod.PUT,
    };
  }
  // HB-242 (TD-09): SCR-23 thuộc lễ tân/quản lý/chủ; oracle không gửi `propertyId` → 400.
  keyed[`${RequestMethod.GET}:operations/day-board`] = {
    roles: ['FRONT_DESK', 'MANAGER', 'OWNER'],
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
  // HB-207 / api.md §2.9: ghi nhận nhiệm vụ/biên bản kiểm chỉ FRONT_DESK, MANAGER; thân oracle không hợp lệ ⇒ 400.
  // prettier-ignore
  keyed[`${RequestMethod.POST}:housekeeping/tasks`] = { roles: ['FRONT_DESK', 'MANAGER'], status: 400, method: RequestMethod.POST };
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
}
