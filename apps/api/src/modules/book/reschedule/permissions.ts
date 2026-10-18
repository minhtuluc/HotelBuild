/**
 * Quyền của hai lệnh HB-098 (api.md §2.5, §6.3 dòng "Tạo/sửa/huỷ booking tại quầy/điện thoại"):
 * FRONT_DESK, RESERVATION_AGENT, MANAGER, OWNER — cùng tập quyền mà HB-097 đã dùng cho
 * `bookings.cancel`/`bookings.cancelPreview` trên đúng hai tuyến của §2.5.
 *
 * api.md §2.5 ghi vai trò tối thiểu của `reschedule` là `GUEST` và của `DELETE` là `FRONT_DESK`.
 * Nhánh khách chưa mở được: `GUEST` không nằm trong `userRoleSchema` nên `PermissionRegistry` từ chối
 * khai nó ngay khi khởi động, còn `AuthGuard` (HB-013) chỉ xác thực phiên nhân viên — đúng khoảng trống
 * đã ghi ở `book/cancel/permissions.ts` và `book/bookings/permissions.ts`. Khi HB-017 mở phiên khách,
 * `reschedule` thêm nhánh "khách tự đổi ngày booking của mình" (như `requireBookingRead` của HB-077);
 * các vai trò khai ở đây vì thế **không** gồm `GUEST`.
 */
import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

const staff = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;

/** Khai báo thuần để test bất biến (vai trò ⊆ `userRoleSchema`) đọc lại được. */
export const reschedulePermissionRules: PermissionRules = {
  'bookings.reschedule': staff,
  'bookings.delete': staff,
};

export const reschedulePermissions = permissionProvider(
  'book-reschedule',
  reschedulePermissionRules,
);
