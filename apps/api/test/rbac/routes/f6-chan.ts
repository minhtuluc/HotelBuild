import { RequestMethod } from '@nestjs/common';
import type { Oracle } from './types.js';

/**
 * F6 — bề mặt CHAN (HB-131 / api.md §2.7 + §6.3, BR-RBAC-03). Oracle **độc lập**: đọc tập vai trò từ
 * hợp đồng đã công bố ở HB-120, không lấy từ cấu hình module.
 *
 * `:channelId` không nằm trong danh sách tham số được thay thế của `registered-routes.spec.ts` nên request
 * oracle mang giá trị `:channelId` nguyên văn: định dạng sai ⇒ **404** trước khi chạm dữ liệu. Vai trò
 * không có quyền luôn nhận 403 từ guard nên trạng thái kỳ vọng chỉ áp cho vai trò được phép.
 */
export function f6Chan(keyed: Oracle): void {
  keyed[`${RequestMethod.POST}:channels/:channelId/sync`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 404,
    method: RequestMethod.POST,
  };
  // Ánh xạ cấu hình là quyền OWNER duy nhất (BR-CHAN-08).
  keyed[`${RequestMethod.PUT}:channels/:channelId/mappings`] = {
    roles: ['OWNER'],
    status: 404,
    method: RequestMethod.PUT,
  };
  keyed[`${RequestMethod.POST}:channels/:channelId/sales-closure`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 404,
    method: RequestMethod.POST,
  };
  for (const path of ['ota-bookings', 'sync-status', 'outbox-deliveries'])
    keyed[`${RequestMethod.GET}:channels/:channelId/${path}`] = {
      roles: ['MANAGER', 'OWNER'],
      status: 404,
      method: RequestMethod.GET,
    };
  keyed[`${RequestMethod.POST}:channels/:channelId/outbox-deliveries/:deliveryId/retry`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 404,
    method: RequestMethod.POST,
  };
}
