/**
 * Phiên khách **thật** cho test token ký tay (TD-59).
 *
 * Các tuyến `@Public` (booking, hold, báo giá) giờ kiểm `auth_sessions` sau khi xác thực chữ ký access token,
 * nên token ký với `sessionId` ngẫu nhiên không có dòng phiên bị từ chối (đúng ý nghĩa bảo mật: chữ ký đúng không
 * thay được phiên còn sống). Fixture mở một dòng `auth_sessions` GUEST rồi ký token bằng chính `id` đó.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type Query = (sql: string, values?: unknown[]) => Promise<unknown>;

/** Hạn xa để không phụ thuộc đồng hồ giả của từng fixture (`expires_at` phải lớn hơn `clock.now()`). */
const FAR_FUTURE = '2100-01-01T00:00:00Z';

/** Mở phiên khách `GUEST_WEB` cho `guests.id` đã có và trả `auth_sessions.id` để ký access token. */
export async function openGuestSession(
  query: Query,
  guestId: string,
  surface: 'GUEST_WEB' | 'GUEST_ANDROID' = 'GUEST_WEB',
): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO auth_sessions(id, principal_type, guest_id, surface, family_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES($1, 'GUEST', $2, $3, $4, $5, now(), now(), $6)`,
    [
      id,
      guestId,
      surface,
      randomUUID(),
      createHash('sha256').update(randomBytes(32)).digest('hex'),
      FAR_FUTURE,
    ],
  );
  return id;
}
