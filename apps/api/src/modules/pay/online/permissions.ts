import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * Quyền của **nhân viên** trên hai tuyến PAY trực tuyến (api.md §2.6, §6.1): `POST /payments/online`
 * vai trò tối thiểu FRONT_DESK; ACCOUNTANT chỉ nhận projection đối soát (`/reconciliation/**`) nên không
 * có quyền thu tiền, HOUSEKEEPING/SYSADMIN không thao tác dữ liệu tiền.
 *
 * Phiên **khách** không phải vai trò trong `userRoleSchema` nên không khai được ở đây: tuyến là `@Public()`
 * và module tự phân giải chủ thể bằng `bookingCaller` của HB-077 (xem `controller.ts`, `principal.ts`).
 * Khi HB-017 mở phiên khách chính thức, hai tuyến chuyển sang guard chung và bỏ nhánh tại chỗ.
 */
const onlinePayerRoles = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;

/** Khai báo thuần để test bất biến (vai trò ⊆ `userRoleSchema`) đọc lại được. */
export const onlinePaymentPermissionRules: PermissionRules = {
  'payments.online': onlinePayerRoles,
};

export const onlinePaymentPermissions = permissionProvider(
  'pay-online',
  onlinePaymentPermissionRules,
);
