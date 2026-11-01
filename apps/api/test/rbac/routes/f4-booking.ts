import { RequestMethod } from '@nestjs/common';
import { GUEST_STAFF, readMissing, type Oracle } from './types.js';

/** F4 — khách, CRM, booking và walk-in. */
export function f4Booking(keyed: Oracle): void {
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
  // prettier-ignore
  keyed[`${RequestMethod.POST}:bookings/:bookingId/confirm`] = { roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'], status: 400, method: RequestMethod.POST };
  // HB-151 / UC-BOOK-02 + api.md §2.5, §6.3: walk-in tạo booking kênh WALKIN là tuyến nhân viên
  // (`bookings.create`); thân oracle không hợp lệ ⇒ 400 sau khi qua quyền, trước khi chạm dữ liệu.
  keyed[`${RequestMethod.POST}:walk-in`] = {
    roles: ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
    status: 400,
    method: RequestMethod.POST,
  };
}
