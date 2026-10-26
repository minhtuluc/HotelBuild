/**
 * Khai báo permission của module người dùng (HB-016). api.md §2.1/§6.3: danh sách cho MANAGER trở lên
 * (MANAGER chỉ thấy người dùng thuộc cơ sở của mình); tạo và gán quyền chỉ OWNER/SYSADMIN, luật gán chi tiết
 * (SYSADMIN không gán OWNER/SYSADMIN, không tự sửa mình, không vô hiệu OWNER cuối) nằm ở `rules.ts`.
 */
import { permissionProvider } from '../../../common/rbac/permissions.js';

export const usersPermissions = permissionProvider('users', {
  'users.read': ['MANAGER', 'OWNER', 'SYSADMIN'],
  'users.create': ['OWNER', 'SYSADMIN'],
  'users.access': ['OWNER', 'SYSADMIN'],
});
