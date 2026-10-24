/**
 * Hạn mức yêu cầu đặt lại mật khẩu (QĐ-03 T7): tối đa 3 yêu cầu / giờ / SĐT chuẩn hoá, **cửa sổ trượt** tính
 * theo `Clock` (không dựa TTL Redis). Mọi SĐT hợp lệ đều bị đếm như nhau — có tài khoản hay không — để
 * không lộ tồn tại qua 429. Khoá Redis chỉ chứa SHA-256 của SĐT, không chứa SĐT.
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { CLOCK, ID_GENERATOR } from '../../../../infrastructure/ports.js';
import { REDIS } from '../../../../infrastructure/redis/redis.module.js';
import type { RedisClient } from '../../../../infrastructure/redis/redis.module.js';

export const RESET_REQUEST_LIMIT = 3;
export const RESET_REQUEST_WINDOW_MS = 3_600_000;

/** Cắt các mốc đã hết cửa sổ rồi đếm; chưa đủ hạn mức thì ghi mốc mới, ngược lại trả mili-giây còn phải chờ. */
const SLIDING_WINDOW = `
local now=tonumber(ARGV[1]); local window=tonumber(ARGV[2]); local limit=tonumber(ARGV[3]);
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-window);
if redis.call('ZCARD',KEYS[1])>=limit then
  local oldest=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES');
  return tonumber(oldest[2])+window-now;
end;
redis.call('ZADD',KEYS[1],now,ARGV[4]);
redis.call('PEXPIRE',KEYS[1],window*2);
return 0;
`;

@Injectable()
export class PasswordResetAttempts {
  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  /** `null` khi còn trong hạn mức (và đã ghi nhận lượt này); ngược lại số giây phải chờ (1..3600). */
  async retryAfterSeconds(phone: string): Promise<number | null> {
    const key = `auth:reset:${createHash('sha256').update(phone).digest('hex')}`;
    const waitMs = Number(
      await this.redis.eval(
        SLIDING_WINDOW,
        1,
        key,
        this.clock.now().getTime(),
        RESET_REQUEST_WINDOW_MS,
        RESET_REQUEST_LIMIT,
        this.ids.generate(),
      ),
    );
    if (!Number.isFinite(waitMs) || waitMs <= 0) return null;
    return Math.min(Math.max(Math.ceil(waitMs / 1000), 1), RESET_REQUEST_WINDOW_MS / 1000);
  }
}
