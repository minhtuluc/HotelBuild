import { permissionProvider } from '../../../common/rbac/permissions.js';
/** HB-034 AC2 / BR-INV-06: overlap override is checked separately in the locked use case. */
export const roomBlockPermissions = permissionProvider('room-blocks', {
  'roomBlocks.create': ['FRONT_DESK', 'MANAGER', 'OWNER'],
  'roomBlocks.remove': ['MANAGER', 'OWNER'],
  'roomBlocks.read': ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'],
});
