import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * Quyền của **nhân viên** trên tuyến holds (api.md §2.5: `DELETE /holds/{holdId}` vai trò tối thiểu
 * FRONT_DESK). `POST /holds` là tuyến của **phiên khách** — `GUEST` không phải vai trò trong
 * `userRoleSchema` nên `PermissionRegistry` từ chối khai nó ngay khi khởi động; phiên khách thuộc
 * HB-017 (xem `principal.ts`), vì vậy ở đây chỉ khai thao tác nhân viên.
 */
const staff = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;

/** Khai báo thuần để test bất biến (vai trò ⊆ `userRoleSchema`) đọc lại được. */
export const holdPermissionRules: PermissionRules = {
  'holds.release': staff,
};

export const holdPermissions = permissionProvider('book-holds', holdPermissionRules);
