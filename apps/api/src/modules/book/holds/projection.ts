/**
 * Bản ghi `Hold` của csdl.md §3 — **Redis 7, khoá `hold:<bookingId>`**, TTL theo
 * `channels.hold_minutes`, các trường `id`, `bookingId`, `channelId`, `expiresAt`,
 * `status` (`ACTIVE`/`RELEASED`/`EXPIRED`), `releasedAt`.
 *
 * Đây **chỉ là bộ đếm nhanh**: ADR-014 và BR-INV-04 chốt nguồn bền là `bookings.hold_expires_at` +
 * `room_assignments`, và mọi truy vấn tồn phòng đọc từ đó chứ không đọc Redis. Vì vậy ghi Redis là
 * **best-effort**: Redis lỗi không được làm hỏng lệnh giữ chỗ (nếu không, mất Redis là mất luôn khả
 * năng bán), nhưng cũng **không** nuốt im lặng — có cảnh báo để job đối chiếu `holdReconcile` 900 giây
 * (HB-078) bắt được hold treo.
 */
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RedisClient } from '../../../infrastructure/redis/redis.module.js';

export const HOLD_KEY_PREFIX = 'hold:';

export const holdRecordSchema = z.object({
  id: z.string().min(1),
  bookingId: z.string().min(1),
  channelId: z.string().min(1),
  expiresAt: z.string().min(1),
  status: z.enum(['ACTIVE', 'RELEASED', 'EXPIRED']),
  releasedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  quotedTotal: z.number().int().min(0),
});

export type HoldRecord = z.infer<typeof holdRecordSchema>;

export class HoldProjection {
  private readonly logger = new Logger(HoldProjection.name);

  constructor(readonly redis: RedisClient) {}

  /** Ghi bản ghi hold đang hoạt động với TTL đúng hạn giữ chỗ của kênh. */
  async save(record: HoldRecord, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(
        `${HOLD_KEY_PREFIX}${record.bookingId}`,
        JSON.stringify(record),
        'EX',
        Math.max(1, ttlSeconds),
      );
    } catch {
      this.logger.warn(
        `Không ghi được bản ghi Hold tạm cho booking ${record.bookingId}; nguồn chân lý là hold_expires_at, job đối chiếu HB-078 sẽ dọn.`,
      );
    }
  }

  /** Cập nhật trạng thái đã giải phóng, giữ nguyên TTL còn lại của khoá (không kéo dài hold). */
  async markReleased(bookingId: string, releasedAt: Date): Promise<void> {
    const key = `${HOLD_KEY_PREFIX}${bookingId}`;
    try {
      const raw = await this.redis.get(key);
      // Khoá đã biến mất (TTL/eviction) ⇒ không còn gì để đối chiếu; nguồn bền đã giải phóng.
      if (raw === null) return;
      const parsed = holdRecordSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      await this.redis.set(
        key,
        JSON.stringify({
          ...parsed.data,
          status: 'RELEASED',
          releasedAt: releasedAt.toISOString(),
        }),
        'KEEPTTL',
      );
    } catch {
      this.logger.warn(
        `Không cập nhật được bản ghi Hold tạm cho booking ${bookingId} sau khi giải phóng.`,
      );
    }
  }
}
