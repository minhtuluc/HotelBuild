/**
 * Luật truy cập của hai tuyến PAY trực tuyến (HB-094; api.md §2.6, §6.1).
 *
 * Chủ thể phân giải bằng `bookingCaller` của HB-077 (`book/bookings/principal.ts`) — **một chỗ** xác
 * thực Bearer, đọc lại `users.role`/`is_active`/phạm vi cơ sở từ CSDL cho nhân viên và nhận diện phiên
 * khách của HB-017. Ở đây chỉ có luật riêng của tuyến: khách **chỉ** thanh toán cho booking của mình
 * (booking người khác ⇒ `404 E_GEN_NOT_FOUND`, không lộ sự tồn tại — api.md §1.4), nhân viên cần quyền
 * `payments.online` **và** đúng phạm vi cơ sở (BR-RBAC-02/03).
 */
import type { PermissionLookup } from '../../../common/actor/authorized-actor.js';
import type { BookingCaller } from '../../book/bookings/principal.js';
import { forbidden, missing, outOfScope } from './validation.js';

/** Vai trò nhân viên của tuyến (§6.1: `POST /payments/online` tối thiểu FRONT_DESK; ACCOUNTANT chỉ đối soát). */
export function requireOnlinePayment(
  permissions: PermissionLookup,
  caller: BookingCaller,
  target: { readonly guestId: string; readonly propertyId: string },
): void {
  if (caller.type === 'GUEST') {
    if (caller.id !== target.guestId) throw missing();
    return;
  }
  if (!permissions.allows(caller.role, 'payments.online')) throw forbidden();
  if (caller.role === 'OWNER') return;
  if (caller.role === 'SYSADMIN' || !caller.propertyScope.includes(target.propertyId))
    throw outOfScope();
}
