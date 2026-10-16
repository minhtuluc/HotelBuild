import { permissionProvider } from '../../../common/rbac/permissions.js';

/** BR-RBAC-02/03 + api.md §2.4: MANAGER đọc lịch giá của cơ sở mình, chỉ OWNER ghi đè giá. */
export const rateCalendarPermissions = permissionProvider('rate-calendar', {
  'rateCalendar.read': ['MANAGER', 'OWNER'],
  'rateCalendar.override': ['OWNER'],
});
