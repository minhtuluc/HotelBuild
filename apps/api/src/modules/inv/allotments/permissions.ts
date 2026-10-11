import { permissionProvider } from '../../../common/rbac/permissions.js';
/** HB-035 AC4 / api.md §2.3: global SYSADMIN has no operations-data access. */
export const allotmentPermissions = permissionProvider('allotments', {
  'allotments.read': ['MANAGER', 'OWNER'],
  'allotments.write': ['MANAGER', 'OWNER'],
});
