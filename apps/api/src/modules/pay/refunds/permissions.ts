import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §3.6/§3.7 + §6.3: lập hồ sơ là tuyến quầy/điều phối (`isForceMajeure` còn đòi MANAGER+);
 * duyệt/từ chối chỉ MANAGER/OWNER — hai cấp là **người lập ≠ người duyệt** ở mọi mức tiền, không phải
 * chuỗi MANAGER rồi OWNER (BR-CANCEL-15). Rút yêu cầu: người tạo hoặc MANAGER/OWNER (BR-CANCEL-18).
 */
const staff = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;
const decider = ['MANAGER', 'OWNER'] as const;

/** api.md §6.3 — đọc hồ sơ hoàn: tập vận hành + ACCOUNTANT đối soát; không cấp HOUSEKEEPING/SYSADMIN. */
const reader = [...staff, 'ACCOUNTANT'] as const;

/** Khai báo thuần để test bất biến (vai trò ⊆ `userRoleSchema`) đọc lại được. */
export const refundPermissionRules: PermissionRules = {
  'refunds.read': reader,
  'refunds.create': staff,
  'refunds.approve': decider,
  'refunds.reject': decider,
  'refunds.cancel': staff,
};

export const refundPermissions = permissionProvider('pay-refunds', refundPermissionRules);
