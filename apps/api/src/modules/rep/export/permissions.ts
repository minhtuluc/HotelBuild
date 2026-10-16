import { permissionProvider } from '../../../common/rbac/permissions.js';

/** api.md §2.12: xuất báo cáo cho kế toán (và chủ chuỗi). */
export const reportExportPermissions = permissionProvider('rep-export', {
  'reports.export': ['ACCOUNTANT', 'OWNER'],
});
