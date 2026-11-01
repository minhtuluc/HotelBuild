/**
 * Hạn mức theo **IP** cho `POST /guest-auth/password-reset/confirm` (TD-60): hợp đồng đã công bố `429
 * E_GEN_RATE_LIMITED` cho tuyến này nhưng mã chưa từng trả. Cùng giao thức với
 * `modules/inv/availability/rate-limit.ts`: một `INCR` nguyên tử, cửa sổ suy từ `Clock` nên không phụ thuộc
 * TTL Redis; Redis lỗi thì yêu cầu thất bại (fail-closed).
 *
 * Token đặt lại là 256-bit dùng một lần nên hạn mức ở đây **không** phải hàng rào chống đoán token — nó chặn
 * một nguồn bơm vô hạn vào tuyến công khai (mỗi lượt là một truy vấn CSDL + một lần băm argon2).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AppError } from '../../../../common/app-error.js';
import { CLOCK } from '../../../../infrastructure/ports.js';
import { REDIS } from '../../../../infrastructure/redis/redis.module.js';
import type { RedisClient } from '../../../../infrastructure/redis/redis.module.js';

/** Cửa sổ 10 phút: người dùng thật gọi ≤ 2 lượt; 30 lượt đủ rộng cho mạng chung (NAT) và bộ test. */
export const CONFIRM_IP_WINDOW_MS = 600_000;
export const CONFIRM_IP_LIMIT = 30;

@Injectable()
export class PasswordResetConfirmLimit {
  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async assertAllowed(ip: string): Promise<void> {
    const now = this.clock.now().getTime();
    const windowIndex = Math.floor(now / CONFIRM_IP_WINDOW_MS);
    const count = Number(
      await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        1,
        `auth:reset-confirm:${ip}:${windowIndex}`,
        Math.ceil((CONFIRM_IP_WINDOW_MS * 2) / 1000),
      ),
    );
    if (count <= CONFIRM_IP_LIMIT) return;
    const windowEnd = (windowIndex + 1) * CONFIRM_IP_WINDOW_MS;
    const retryAfter = Math.ceil((windowEnd - now) / 1000);
    throw new AppError(
      429,
      'E_GEN_RATE_LIMITED',
      'Bạn đã gửi quá nhiều yêu cầu đặt lại mật khẩu, vui lòng chờ.',
      Math.min(Math.max(retryAfter, 1), Math.ceil(CONFIRM_IP_WINDOW_MS / 1000)),
    );
  }
}
