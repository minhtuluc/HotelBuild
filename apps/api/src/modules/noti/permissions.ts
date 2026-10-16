import { permissionProvider } from '../../common/rbac/permissions.js';

/**
 * api.md §2.11 (NOTI) + BR-RBAC-03: danh sách/gửi lại thông báo là thao tác vận hành của quầy.
 * `FRONT_DESK` ở api.md là vai trò tối thiểu nên `RESERVATION_AGENT`/`MANAGER`/`OWNER` làm cùng được
 * (cùng cách `guests.read`/`guests.create` của HB-149 mở rộng vai trò tối thiểu `FRONT_DESK`);
 * `HOUSEKEEPING`/`ACCOUNTANT`/`SYSADMIN` không thấy nội dung gửi khách (BR-RBAC-02/03).
 */
export const notificationPermissions = permissionProvider('noti-notifications', {
  'notifications.read': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
  'notifications.resend': ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'],
});
