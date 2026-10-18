/**
 * Khai báo permission của module PIN (HB-015). Module tự sở hữu tập quyền của mình nên
 * không phải sửa thang vai trò toàn cục (common/rbac/permissions.ts).
 *
 * Căn cứ: api.md §2.1 (`POST /auth/pin/verify` vai trò tối thiểu FRONT_DESK; `PUT /auth/pin`
 * cho người đã đăng nhập; `DELETE /users/{userId}/pin` MANAGER/SYSADMIN), BR-RBAC-05, §6.3.
 */
import { permissionProvider } from '../../../common/rbac/permissions.js';

/** Người có thể thực hiện thao tác tài chính 🔒 nên được mở khoá PIN (api.md §6.3). */
const financialStaff = [
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'MANAGER',
  'OWNER',
  'ACCOUNTANT',
] as const;
/** Mọi nhân viên đã đăng nhập tự đặt PIN của mình (QĐ-03 quyết định 5). */
const allStaff = [
  'OWNER',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
  'SYSADMIN',
] as const;

export const pinPermissions = permissionProvider('pin', {
  'pin.verify': [...financialStaff],
  'pin.set': [...allStaff],
  'pin.delete': ['MANAGER', 'SYSADMIN'],
});
