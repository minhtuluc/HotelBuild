import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * Quyền của **nhân viên** trên tuyến bookings (api.md §2.5, §6.3):
 * - `bookings.read`: "Xem booking/lịch tồn vận hành" — FRONT_DESK, RESERVATION_AGENT, MANAGER, OWNER.
 *   ACCOUNTANT chỉ nhận projection đối soát (`GET /bookings/{id}/balance`, HB-096) và HOUSEKEEPING dùng
 *   task/rooms tối giản nên **không** có tuyến booking nào;
 * - `bookings.create`: "Tạo/sửa/huỷ booking tại quầy/điện thoại";
 * - `bookings.confirm`: `POST /bookings/{bookingId}/confirm` (vai trò tối thiểu FRONT_DESK).
 *
 * `POST /bookings`, `GET /bookings` và `GET /bookings/{id}` là tuyến của **phiên khách** nữa (api.md
 * §2.5 vai trò GUEST). `GUEST` không phải vai trò trong `userRoleSchema` nên `PermissionRegistry` từ
 * chối khai nó ngay khi khởi động, và phiên khách thuộc HB-017 — vì vậy ba tuyến đó là `@Public()` và
 * module tự phân giải chủ thể, kiểm quyền nhân viên ở đây theo cùng tên quyền (xem `principal.ts`).
 */
const readers = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;

/** Khai báo thuần để test bất biến (vai trò ⊆ `userRoleSchema`) đọc lại được. */
export const bookingPermissionRules: PermissionRules = {
  'bookings.read': readers,
  'bookings.create': readers,
  'bookings.confirm': readers,
};

export const bookingPermissions = permissionProvider('book-bookings', bookingPermissionRules);
