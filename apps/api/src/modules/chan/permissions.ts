import { permissionProvider } from '../../common/rbac/permissions.js';

/**
 * HB-131 / api.md §2.7 + §6.3, BR-RBAC-03 — quyền CHAN **tường minh**, không suy ra từ thứ bậc vai trò.
 *
 * - `channels.read` (danh sách kênh) đã do module `rate/channels` khai; ở đây không khai lại (registry
 *   từ chối quyền trùng tên).
 * - Ánh xạ cấu hình là quyền **OWNER duy nhất**: người vận hành cơ sở cấu hình đóng bán và chạy sync,
 *   nhưng không tự mở/đổi ánh xạ mã phòng OTA (BR-CHAN-08).
 * - Không mở bất kỳ quyền CHAN nào cho FRONT_DESK/RESERVATION_AGENT/ACCOUNTANT/HOUSEKEEPING/SYSADMIN:
 *   quyền đọc booking thông thường không kéo theo quyền đối soát kênh.
 *
 * Provider này được đăng ký **một lần** (trong `sync/module.ts`) để registry không thấy hai bản khai
 * cùng tên; các module CHAN khác dùng `@Permission` với các khoá dưới đây.
 */
export const chanPermissions = permissionProvider('chan', {
  'channels.sync': ['MANAGER', 'OWNER'],
  'channels.mappings': ['OWNER'],
  'channels.salesClosure': ['MANAGER', 'OWNER'],
  'channels.otaBookings': ['MANAGER', 'OWNER'],
  'channels.syncStatus': ['MANAGER', 'OWNER'],
  'channels.deliveries': ['MANAGER', 'OWNER'],
  'channels.deliveryRetry': ['MANAGER', 'OWNER'],
});
