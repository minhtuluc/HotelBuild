import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §2.5/§3.3: quầy/điều phối/marketing huỷ và xem trước; **khách GUEST tự huỷ booking của mình**.
 * Phiên khách chưa tồn tại trong API (HB-017) và `GUEST` không phải vai trò người dùng — hợp đồng
 * `userRoleSchema` chỉ có bảy vai trò nhân viên, còn `PermissionRegistry` từ chối vai trò lạ ngay khi
 * khởi động — nên không khai `GUEST` ở đây trước khi HB-017 mở đường phiên khách (README + test bất biến).
 */
const staff = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;

/** Khai báo thuần để test bất biến (vai trò ⊆ `userRoleSchema`) đọc lại được. */
export const cancelPermissionRules: PermissionRules = {
  'bookings.cancelPreview': staff,
  'bookings.cancel': staff,
};

export const cancelPermissions = permissionProvider('book-cancel', cancelPermissionRules);
