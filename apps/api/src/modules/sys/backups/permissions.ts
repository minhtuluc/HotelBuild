import { permissionProvider } from '../../../common/rbac/permissions.js';

/** api.md §2.13 + UC-SYS-03: sao lưu và diễn tập phục hồi là việc của quản trị hệ thống (ACT-12). */
export const backupPermissions = permissionProvider('sys-backups', {
  'systemBackups.read': ['SYSADMIN'],
  'systemBackups.request': ['SYSADMIN'],
});
