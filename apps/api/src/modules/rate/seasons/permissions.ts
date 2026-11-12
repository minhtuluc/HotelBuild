import { permissionProvider } from '../../../common/rbac/permissions.js';

/** BR-RBAC-02/03 + api.md §2.4: MANAGER xem mùa của cơ sở mình, chỉ OWNER tạo và sửa/ngừng mùa. */
export const seasonPermissions = permissionProvider('rate-seasons', {
  'seasons.read': ['MANAGER', 'OWNER'],
  'seasons.create': ['OWNER'],
  'seasons.update': ['OWNER'],
});
