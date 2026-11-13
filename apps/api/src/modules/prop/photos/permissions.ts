import { permissionProvider } from '../../../common/rbac/permissions.js';

/** HB-244: MANAGER/OWNER xem danh sách ảnh quản trị (kèm ETag), chỉ OWNER thay ảnh (như cấu hình cơ sở). */
export const photoPermissions = permissionProvider('prop-photos', {
  'photos.read': ['MANAGER', 'OWNER'],
  'photos.replace': ['OWNER'],
});
