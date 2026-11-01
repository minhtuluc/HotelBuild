/**
 * Quyền của lệnh chốt đối soát ngày (HB-150; api.md §2.6, §6.1, §6.3, BR-RBAC-03).
 *
 * `reconciliation.close` = kế toán chốt quỹ cuối ngày theo `(người thu, ngày VN)`. api.md §2.6 và
 * bảng permission §6.3 chỉ cấp nhóm "đối soát" cho ACCOUNTANT; lễ tân là người thu tiền nhưng không
 * được tự chốt quỹ (tách nhiệm vụ, tránh tự đối soát khoản mình thu).
 */
import { permissionProvider } from '../../../common/rbac/permissions.js';

export const reconciliationPermissions = permissionProvider('pay-reconciliation', {
  'reconciliation.close': ['ACCOUNTANT'],
});
