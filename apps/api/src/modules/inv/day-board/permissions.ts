import { permissionProvider } from '../../../common/rbac/permissions.js';

/**
 * HB-242 (TD-09): SCR-23 thuộc ACT-02/03/04 (lễ tân, quản lý, chủ). Bảng có tên khách và số dư nên
 * không cấp HOUSEKEEPING/ACCOUNTANT/SYSADMIN; buồng phòng dùng màn nhiệm vụ riêng.
 */
export const dayBoardPermissions = permissionProvider('inventory-day-board', {
  'operations.dayBoard': ['FRONT_DESK', 'MANAGER', 'OWNER'],
});
