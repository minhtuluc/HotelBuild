/**
 * Luật chủ thể/quyền của lệnh thu tại quầy (HB-096; api.md §2.6, §6.1, §6.3).
 *
 * Tuyến `POST /payments` **có** `@Permission('payments.collect')` + `@Idempotent` nên `request.actor`
 * đã được `AuthGuard` (HB-013) + `RbacGuard` (HB-014) đọc lại vai trò/phạm vi từ CSDL — dùng lại,
 * không xác thực token lần hai. Ngoài tập quyền của guard, lệnh còn phải kiểm:
 * - phạm vi cơ sở `booking.propertyId ∈ propertyScope` (BR-RBAC-02);
 * - điều kiện **dữ liệu** §6.3 "Tạo booking, nhận cọc": **RESERVATION_AGENT chỉ nhận cọc**
 *   (`DEPOSIT`) — đây là ràng buộc theo loại khoản nên nằm ở đây, không ở bảng permission.
 *
 * Kiểm ở **cả** tiền kiểm idempotency (trước claim) **và** trong transaction sau khoá booking (HB-093).
 */
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { PaymentCreateRequest } from '@pinehill/contracts';
import { paymentCreateRequestSchema } from '@pinehill/contracts';
import { forbidden, invalid, outOfScope } from './errors.js';

export interface CounterCommand {
  readonly bookingId: string;
  readonly type: PaymentCreateRequest['type'];
  readonly method: PaymentCreateRequest['method'];
  readonly amount: PaymentCreateRequest['amount'];
  readonly note?: string | undefined;
  readonly pinToken?: string | undefined;
}

/** Kiểm thân lệnh: sai cú pháp → 400 trước khi tra tài nguyên (không để lại idempotency rác). */
export function counterCommand(value: unknown): CounterCommand {
  const parsed = paymentCreateRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

/** `RESERVATION_AGENT` chỉ nhận cọc — điều kiện dữ liệu của "Tạo booking, nhận cọc" (§6.3, BR-PAY-01). */
function collectBlockedFor(role: string, type: PaymentCreateRequest['type']): boolean {
  return role === 'RESERVATION_AGENT' && type !== 'DEPOSIT';
}

/** Quyền + phạm vi cơ sở của lệnh thu; gọi ở `CounterAccess` **và** đọc lại trong transaction. */
export function requireCollect(
  actor: AuthorizedActor,
  target: { readonly propertyId: string; readonly type: PaymentCreateRequest['type'] },
): void {
  if (!actor.hasPermission('payments.collect')) throw forbidden();
  if (collectBlockedFor(actor.role, target.type)) throw forbidden('Bạn chỉ có quyền nhận cọc.');
  // Cùng luật `canActOn` HB-014: OWNER toàn chuỗi, SYSADMIN không dữ liệu nghiệp vụ.
  if (!actor.canActOn(target.propertyId)) throw outOfScope();
}
