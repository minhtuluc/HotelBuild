import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { AppError } from '../../../common/app-error.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { REDIS } from '../../../infrastructure/redis/redis.module.js';
import type { RedisClient } from '../../../infrastructure/redis/redis.module.js';

/** Cửa sổ đếm và hạn mức cơ bản cho endpoint công khai (HB-075 AC1). */
export const PUBLIC_WINDOW_MS = 60_000;
export const PUBLIC_REQUEST_LIMIT = 120;

/**
 * Hạn mức tần suất theo IP cho `GET /inventory/availability` — cùng giao thức với
 * `LoginAttempts` (`modules/auth/login-attempts.ts`): một lượt đếm `INCR` nguyên tử trên Redis,
 * cửa sổ suy từ `Clock` để không phụ thuộc TTL.
 *
 * Redis lỗi thì yêu cầu thất bại (fail-closed, không nuốt lỗi): hạn mức công khai không được
 * âm thầm bốc hơi khi hạ tầng đọc-ghi dùng chung gặp sự cố.
 */
@Injectable()
export class AvailabilityRateLimit {
  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async assertAllowed(ip: string): Promise<void> {
    const now = this.clock.now().getTime();
    const windowIndex = Math.floor(now / PUBLIC_WINDOW_MS);
    const count = Number(
      await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        1,
        `inv:availability:${ip}:${windowIndex}`,
        Math.ceil((PUBLIC_WINDOW_MS * 2) / 1000),
      ),
    );
    if (count <= PUBLIC_REQUEST_LIMIT) return;
    const windowEnd = (windowIndex + 1) * PUBLIC_WINDOW_MS;
    const retryAfter = Math.ceil((windowEnd - now) / 1000);
    throw new AppError(
      429,
      'E_GEN_RATE_LIMITED',
      'Bạn đã gửi quá nhiều lượt tìm phòng, vui lòng chờ.',
      Math.min(Math.max(retryAfter, 1), Math.ceil(PUBLIC_WINDOW_MS / 1000)),
    );
  }
}
