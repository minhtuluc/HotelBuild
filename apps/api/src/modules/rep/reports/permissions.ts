import { permissionProvider } from '../../../common/rbac/permissions.js';

/**
 * BR-RBAC-01/03 + api.md §2.12: mỗi báo cáo khai tập vai trò tường minh, không có thứ bậc vai trò.
 * Báo cáo tài chính (doanh thu theo kênh, huỷ/hoàn) chỉ ACCOUNTANT/OWNER; `force-majeure` chỉ OWNER
 * (api.md §6.3); báo cáo vận hành (công suất, ADR/RevPAR, quá tải) từ MANAGER trở lên.
 */
export const reportsPermissions = permissionProvider('rep-reports', {
  'reports.occupancy': ['MANAGER', 'OWNER'],
  'reports.adrRevpar': ['MANAGER', 'OWNER'],
  'reports.revenueByChannel': ['ACCOUNTANT', 'OWNER'],
  'reports.cancellations': ['ACCOUNTANT', 'OWNER'],
  'reports.forceMajeure': ['OWNER'],
  'reports.overbooking': ['MANAGER', 'OWNER'],
});
