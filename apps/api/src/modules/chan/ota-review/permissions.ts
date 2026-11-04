import { permissionProvider } from '../../../common/rbac/permissions.js';

/**
 * AC12 + api.md §2.7/§6.3: tuyến soát trùng OTA chỉ dành cho MANAGER/OWNER. Quyền khai theo module
 * (không sửa thang vai trò toàn cục) và `RoutePermissionValidator` chặn khởi động nếu thiếu.
 */
export const otaReviewPermissions = permissionProvider('chan-ota-review', {
  'otaBookings.review': ['MANAGER', 'OWNER'],
});
