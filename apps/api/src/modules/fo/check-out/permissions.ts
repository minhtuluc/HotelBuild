import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §6.3: "Check-in/out, no-show thủ công, thực thi move/merge" là tập **FRONT_DESK**; ticket
 * HB-145 mở thêm MANAGER/OWNER cho quyết định ngoại lệ tại quầy (không so thứ hạng vai trò).
 * RESERVATION_AGENT/ACCOUNTANT/HOUSEKEEPING/SYSADMIN không có quyền này.
 */
export const checkOutRoles = ['FRONT_DESK', 'MANAGER', 'OWNER'] as const;

export const checkOutPermissionRules: PermissionRules = {
  'frontOffice.checkOut': checkOutRoles,
};

export const checkOutPermissions = permissionProvider('fo-check-out', checkOutPermissionRules);
