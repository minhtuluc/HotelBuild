/**
 * Quyền đọc số dư booking (HB-096; api.md §2.6, §6.3, BR-RBAC-03): nhân viên tài chính — không cấp
 * HOUSEKEEPING/SYSADMIN; khách đọc booking của chính mình đi đường principal `GUEST` (HB-017) nên
 * không khai `GUEST` ở đây (`userRoleSchema` từ chối).
 */
import { permissionProvider } from '../../../common/rbac/permissions.js';

export const balancePermissions = permissionProvider('payments-balance', {
  'bookings.balance': ['FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT', 'MANAGER', 'OWNER'],
});
