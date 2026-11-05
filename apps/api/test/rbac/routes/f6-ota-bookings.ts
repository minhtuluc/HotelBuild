import { RequestMethod } from '@nestjs/common';
import type { Oracle } from './types.js';

/**
 * F6 — soát trùng booking OTA (HB-129 AC12; api.md §2.7, §6.3).
 *
 * Tuyến `POST /channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag` là **lệnh có version**
 * của MANAGER/OWNER trong scope: thiếu vai trò ⇒ 403, còn lại thân yêu cầu của oracle (thân tổng hợp
 * `{ role, propertyScope }`) không có `flagged`/`reason` ⇒ 400, và 400 xảy ra **trước** khi tra
 * booking nên không phụ thuộc dữ liệu. Không dùng `:id`/`:bookingId` thay thế được `:channelId`:
 * `registered-routes.spec` chỉ thay các tham số nó biết, phần còn lại vẫn là chuỗi literal trong URL.
 */
export function f6OtaBookings(oracle: Oracle): void {
  oracle[`${RequestMethod.POST}:channels/:channelId/ota-bookings/:bookingId/duplicate-flag`] = {
    roles: ['MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
}
