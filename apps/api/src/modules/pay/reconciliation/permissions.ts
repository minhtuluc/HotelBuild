/**
 * Quyền của lệnh chốt đối soát ngày (HB-150; api.md §2.6, §6.1, §6.3, BR-RBAC-03).
 *
 * `reconciliation.close` = kế toán hoặc lễ tân chốt quỹ cuối ngày theo `(người thu, ngày VN)`.
 */
import { permissionProvider } from '../../../common/rbac/permissions.js';

export const reconciliationPermissions = permissionProvider('pay-reconciliation', {
  'reconciliation.close': ['FRONT_DESK', 'ACCOUNTANT'],
});
