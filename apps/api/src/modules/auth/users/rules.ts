/**
 * Luật gán quyền người dùng nội bộ (QĐ-03 quyết định 7; BR-RBAC-01): hàm thuần để test và để dùng cả ở bước
 * tiền kiểm của idempotency lẫn bên trong transaction sau khi khoá hàng.
 *
 * - OWNER gán mọi vai trò; SYSADMIN gán mọi vai trò **trừ** OWNER và SYSADMIN.
 * - Không ai đổi vai trò/phạm vi/trạng thái của chính mình.
 * - SYSADMIN không sửa tài khoản đang giữ OWNER/SYSADMIN (không khoá được chủ sở hữu hay đổi quyền ngang hàng).
 *   Đây là cách đọc chặt hơn chữ của quyết định 7 (chỉ nói "gán"); ghi trong PR để Opus xác nhận.
 */
import { AppError } from '../../../common/app-error.js';

/** Vai trò toàn cục: không gắn cơ sở (OWNER thấy mọi cơ sở, SYSADMIN không có quyền nghiệp vụ). */
export const GLOBAL_ROLES: ReadonlySet<string> = new Set(['OWNER', 'SYSADMIN']);

export const forbidden = (): AppError =>
  new AppError(403, 'E_RBAC_FORBIDDEN', 'Bạn không được thực hiện thao tác này.');

export const validationFailed = (): AppError =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', 'Yêu cầu không hợp lệ.');

export interface AssignmentContext {
  readonly actorId: string;
  readonly actorRole: string;
  readonly targetId: string | null;
  readonly targetRole: string | null;
  readonly newRole: string;
}

/** Ném 403 nếu người gọi không được thiết lập quyền này cho tài khoản đích. */
export function assertMayAssign(context: AssignmentContext): void {
  const { actorId, actorRole, targetId, targetRole, newRole } = context;
  if (actorRole !== 'OWNER' && actorRole !== 'SYSADMIN') throw forbidden();
  if (targetId !== null && targetId === actorId) throw forbidden();
  if (actorRole === 'SYSADMIN') {
    if (GLOBAL_ROLES.has(newRole)) throw forbidden();
    if (targetRole !== null && GLOBAL_ROLES.has(targetRole)) throw forbidden();
  }
}

/** Vai trò toàn cục không có phạm vi cơ sở; vai trò nghiệp vụ phải có ít nhất một cơ sở. */
export function assertScopeShape(role: string, propertyScope: readonly string[]): void {
  if (GLOBAL_ROLES.has(role) ? propertyScope.length !== 0 : propertyScope.length === 0)
    throw validationFailed();
}
