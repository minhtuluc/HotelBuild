import { permissionProvider } from '../../../common/rbac/permissions.js';

/** BR-RBAC-02/04 + api.md §2.4: MANAGER/OWNER xem khuyến mãi, chỉ OWNER tạo và sửa/ngừng. */
export const promotionPermissions = permissionProvider('rate-promotions', {
  'promotions.read': ['MANAGER', 'OWNER'],
  'promotions.create': ['OWNER'],
  'promotions.update': ['OWNER'],
});
