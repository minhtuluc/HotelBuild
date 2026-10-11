import { permissionProvider } from '../../../common/rbac/permissions.js';
/** BR-RBAC-03 / UC-INV-01: operations readers only, scoped to their properties. */
export const gridPermissions = permissionProvider('inventory-grid', {
  'inventory.grid': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
});
