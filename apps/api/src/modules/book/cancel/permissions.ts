import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §2.5/§3.3: quầy/điều phối/marketing huỷ và xem trước; **khách GUEST tự huỷ booking của mình**.
 * `GUEST` không phải vai trò người dùng (`userRoleSchema` chỉ có bảy vai trò nhân viên, `PermissionRegistry`
 * từ chối vai trò lạ khi khởi động) nên không khai ở đây: nhánh khách đi qua `cancelCaller` (HB-256) và
 * chỉ được đụng booking của chính mình. Bảng này là quyền của **nhân viên** trên hai tuyến.
 */
const staff = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;

/** Khai báo thuần để test bất biến (vai trò ⊆ `userRoleSchema`) đọc lại được. */
export const cancelPermissionRules: PermissionRules = {
  'bookings.cancelPreview': staff,
  'bookings.cancel': staff,
};

export const cancelPermissions = permissionProvider('book-cancel', cancelPermissionRules);
