import { RequestMethod } from '@nestjs/common';
import type { Oracle } from './types.js';

/** F8 — báo cáo, thông báo và thao tác vận hành. */
export function f8Report(keyed: Oracle): void {
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
}
