import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §2.9 + §6.3: no-show thủ công thuộc nhóm "Check-in/out, no-show thủ công, thực thi move/merge",
 * mà §6.3 cấp **FRONT_DESK**. Không nới thêm vai trò nào (kể cả MANAGER/OWNER): BR-RBAC-03 nói OWNER
 * không có nghĩa được phép mọi thao tác, và không có yêu cầu nghiệp vụ nào cần vai trò khác ghi no-show.
 */
export const noShowPermissionRules: PermissionRules = {
  'frontOffice.noShow': ['FRONT_DESK'],
};

export const noShowPermissions = permissionProvider('fo-no-show', noShowPermissionRules);
