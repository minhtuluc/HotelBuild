import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §2.9 + §6.3: no-show thủ công thuộc nhóm "Check-in/out, no-show thủ công, thực thi move/merge".
 * Ticket HB-147 mở cho lễ tân và hai vai trò quyết định (MANAGER/OWNER) — không thêm vai trò nào khác:
 * RESERVATION_AGENT/ACCOUNTANT/HOUSEKEEPING vẫn bị `RbacGuard` chặn (BR-RBAC-03).
 */
export const noShowPermissionRules: PermissionRules = {
  'frontOffice.noShow': ['FRONT_DESK', 'MANAGER', 'OWNER'],
};

export const noShowPermissions = permissionProvider('fo-no-show', noShowPermissionRules);
