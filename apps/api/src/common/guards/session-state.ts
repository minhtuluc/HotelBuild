/**
 * Trạng thái phiên trong CSDL — **một** nơi quyết định "phiên còn dùng được không" (BR-RBAC-05; QĐ-03).
 *
 * `AuthGuard` (tuyến có `@Permission`) và các tuyến `@Public` tự phân giải chủ thể (booking, hold, báo giá,
 * `guest-auth/logout`) đều gọi hàm này sau khi xác thực chữ ký/hạn của access token. Nếu chỉ kiểm chữ ký thì
 * token của phiên đã đăng xuất/replay vẫn dùng được tới hết hạn access token (TD-59). Trả `null` khi phiên:
 * không tồn tại (đã dọn), đã thu hồi, sai chủ, hết hạn, hoặc (phiên nhân viên `OPS_WEB`) nhàn rỗi quá ngưỡng.
 * Phiên không tồn tại bị từ chối (fail-closed): chữ ký đúng không thay được dòng phiên.
 */
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { DatabaseClient } from '../../infrastructure/prisma/prisma.module.js';

/** Phiên nhân viên `OPS_WEB` hết hạn sau 15 phút nhàn rỗi (TC-AUTH-02). */
export const IDLE_TIMEOUT_MS = 15 * 60_000;
/** Nhịp cập nhật `last_seen_at` tối thiểu (QĐ-03 quyết định 9). */
export const LAST_SEEN_THROTTLE_MS = 60_000;

/** Phiên kèm người dùng (phiên khách có `users = null`). */
export type SessionWithUser = Prisma.auth_sessionsGetPayload<{ include: { users: true } }>;

export async function findUsableSession(
  prisma: Pick<DatabaseClient, 'auth_sessions'>,
  clock: Clock,
  sessionId: string,
  ownerId: string,
): Promise<SessionWithUser | null> {
  const session = await prisma.auth_sessions.findUnique({
    where: { id: sessionId },
    include: { users: true },
  });
  const now = clock.now();
  if (
    session === null ||
    session.revoked_at !== null ||
    (session.principal_type === 'GUEST' ? session.guest_id : session.user_id) !== ownerId ||
    session.expires_at.getTime() <= now.getTime()
  )
    return null;
  if (
    session.surface === 'OPS_WEB' &&
    now.getTime() - session.last_seen_at.getTime() >= IDLE_TIMEOUT_MS
  )
    return null;
  if (now.getTime() - session.last_seen_at.getTime() >= LAST_SEEN_THROTTLE_MS)
    await prisma.auth_sessions.update({ where: { id: session.id }, data: { last_seen_at: now } });
  return session;
}
