import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §2.9 + §6.3: "Check-in/out, no-show thủ công" là tuyến **FRONT_DESK**.
 *
 * MANAGER/OWNER cũng gọi được vì họ là người **duyệt ngoại lệ** ngay trên cùng request: BR-FO-01 chỉ
 * cho MANAGER (trong cả hai ngưỡng) hoặc OWNER duyệt cho nợ. Tách quyền duyệt thành endpoint riêng sẽ
 * tạo hai nguồn quyết định cho cùng một lần giao phòng.
 */
export const checkInPermissionRules: PermissionRules = {
  'frontOffice.checkIn': ['FRONT_DESK', 'MANAGER', 'OWNER'],
};

export const checkInPermissions = permissionProvider(
  'front-office-checkin',
  checkInPermissionRules,
);
