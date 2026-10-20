import { permissionProvider } from '../../../common/rbac/permissions.js';
import type { PermissionRules } from '../../../common/rbac/permissions.js';

/**
 * api.md §2.6/§6.1: **ACCOUNTANT** chi tiền hoàn, chỉ khi hồ sơ `APPROVED`, đúng cơ sở của booking.
 * Kế toán không tự duyệt (`refunds.approve` vẫn là MANAGER/OWNER — BR-CANCEL-15). Khai riêng ở module
 * chi để module hoàn tiền giữ nguyên bộ quyền của nó; registry chặn trùng tên nên không có hai nguồn.
 */
const accountants = ['ACCOUNTANT'] as const;

export const payoutPermissionRules: PermissionRules = {
  'refunds.pay': accountants,
};

export const payoutPermissions = permissionProvider('pay-payouts', payoutPermissionRules);
