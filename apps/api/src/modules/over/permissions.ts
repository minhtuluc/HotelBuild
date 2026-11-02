import { permissionProvider } from '../../common/rbac/permissions.js';
import type { PermissionRules } from '../../common/rbac/permissions.js';

/**
 * api.md §3.10 + §6.3: lập/duyệt/thực thi điều chuyển là tuyến tiền sảnh; duyệt chi phí là MANAGER+;
 * chi bồi thường là ACCOUNTANT (F6-D06). OWNER đứng trên cả hai nhưng vẫn tách tuyến ghi.
 *
 * - `overbookings.cases.read`: danh sách/chi tiết ca và bảng `keepScore` toàn bộ — MANAGER/OWNER.
 * - `overbookings.alerts.read`: projection tối giản cho lễ tân — **chỉ** FRONT_DESK; đổi route không
 *   mở quyền đọc case quản lý (HB-120 AC12).
 */
export const overPermissionRules: PermissionRules = {
  'over.plan': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.resolve': ['MANAGER', 'OWNER'],
  'over.move.create': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.move.read': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.move.approve': ['MANAGER', 'OWNER'],
  'over.move.execute': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.merge.create': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.merge.read': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.merge.consent': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.merge.approve': ['MANAGER', 'OWNER'],
  'over.merge.execute': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.options.read': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'over.compensation.read': ['ACCOUNTANT', 'MANAGER', 'OWNER'],
  'over.compensation.pay': ['ACCOUNTANT'],
  'overbookings.cases.read': ['MANAGER', 'OWNER'],
  'overbookings.alerts.read': ['FRONT_DESK'],
};

export const overPermissions = permissionProvider('over', overPermissionRules);
