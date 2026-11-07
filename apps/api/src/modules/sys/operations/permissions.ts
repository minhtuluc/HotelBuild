import { permissionProvider } from '../../../common/rbac/permissions.js';

/**
 * HB-163 / api.md §6 — theo dõi thao tác bất đồng bộ. Quyền route chỉ mở cho vai trò có thể tạo thao tác
 * (hiện là kế toán/chủ chuỗi cho xuất báo cáo); **kiểm quyền người tạo** nằm trong service vì cùng một
 * `operationId` phải chỉ chủ sở hữu hoặc OWNER xem được (AC1). Mở rộng tập vai trò khi có loại thao tác mới
 * (ví dụ sao lưu ở HB-179).
 */
export const operationsPermissions = permissionProvider('sys-operations', {
  // HB-131: MANAGER theo dõi tác vụ do chính mình khởi tạo (sync kênh/retry delivery); service vẫn chặn
  // người không phải người tạo và kiểm scope hiện tại, OWNER đọc được mọi tác vụ.
  'operations.read': ['OWNER', 'ACCOUNTANT', 'MANAGER'],
  'operations.download': ['OWNER', 'ACCOUNTANT'],
});
