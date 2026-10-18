/**
 * Quyền của lệnh thu tại quầy (HB-096; api.md §2.6, §6.3, BR-RBAC-03): module tự sở hữu tập quyền.
 *
 * `payments.collect` = "Ghi nhận khoản thu" + "Tạo booking, nhận cọc" + "ACCOUNTANT ghi nhận khi đối
 * soát": FRONT_DESK, RESERVATION_AGENT, ACCOUNTANT. Hạn chế **dữ liệu** §6.3 — RESERVATION_AGENT chỉ
 * `DEPOSIT` — kiểm trong module (điều kiện trên dữ liệu, không thuộc bảng permission).
 */
import { permissionProvider } from '../../../common/rbac/permissions.js';

export const counterPermissions = permissionProvider('payments-counter', {
  'payments.collect': ['FRONT_DESK', 'RESERVATION_AGENT', 'ACCOUNTANT'],
});
