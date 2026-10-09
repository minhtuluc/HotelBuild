import { permissionProvider } from '../../common/rbac/permissions.js';
const staff = [
  'OWNER',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
  'SYSADMIN',
];
export const authPermissions = permissionProvider('auth', {
  'auth.me': staff,
  'auth.logout': staff,
  'auth.password': staff,
});
