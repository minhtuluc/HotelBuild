import { permissionProvider } from '../../../common/rbac/permissions.js';

/**
 * UC-CRM-01…03 (api.md §2.10, §6.3): hồ sơ khách dùng cho quầy lễ tân và điều phối đặt phòng; thao tác
 * quản trị (ẩn danh hoá, danh sách đen) chỉ MANAGER/OWNER.
 * `HOUSEKEEPING`/`ACCOUNTANT`/`SYSADMIN` không có quyền trên hồ sơ khách (BR-RBAC-03).
 */
export const guestsPermissions = permissionProvider('crm-guests', {
  'guests.read': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
  'guests.create': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
  'guests.manage': ['MANAGER', 'OWNER'],
});
