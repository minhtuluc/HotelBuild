/**
 * Đếm thất bại đăng nhập (BR-RBAC-06) trên Redis:
 * - hạn mức **theo IP**: 10 lần thất bại trong 60 giây (dùng mốc thời gian thật từ `Clock`, không dựa TTL Redis);
 * - khoá theo **tên đăng nhập không tồn tại**: 5 lần liên tiếp → khoá 15 phút, cùng thông điệp như tài khoản thật.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { CLOCK } from '../../infrastructure/ports.js';
import { REDIS } from '../../infrastructure/redis/redis.module.js';
import type { RedisClient } from '../../infrastructure/redis/redis.module.js';

/** Số lần thất bại tối đa cho mỗi IP trong một cửa sổ (api.md §1.2). */
export const IP_FAILURE_LIMIT = 10;
/** Cửa sổ đếm theo IP. */
export const IP_FAILURE_WINDOW_MS = 60_000;

interface AttemptState {
  failures: number;
  lockedUntilMs: number | null;
}

@Injectable()
export class LoginAttempts {
  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private ipKey(ip: string, windowIndex: number): string {
    return `auth:ip:${ip}:${windowIndex}`;
  }

  private usernameKey(username: string): string {
    return `auth:user:${username.toLowerCase()}`;
  }

  private windowIndex(at: number): number {
    return Math.floor(at / IP_FAILURE_WINDOW_MS);
  }

  /** `null` khi còn trong hạn mức; ngược lại số giây phải chờ (1..60). */
  async ipRetryAfterSeconds(ip: string): Promise<number | null> {
    const now = this.clock.now().getTime();
    const count = Number((await this.redis.get(this.ipKey(ip, this.windowIndex(now)))) ?? '0');
    if (!Number.isFinite(count) || count < IP_FAILURE_LIMIT) return null;
    const windowEnd = (this.windowIndex(now) + 1) * IP_FAILURE_WINDOW_MS;
    const remaining = Math.ceil((windowEnd - now) / 1000);
    return Math.min(Math.max(remaining, 1), Math.ceil(IP_FAILURE_WINDOW_MS / 1000));
  }

  async recordIpFailure(ip: string): Promise<void> {
    const now = this.clock.now().getTime();
    const key = this.ipKey(ip, this.windowIndex(now));
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, Math.ceil((IP_FAILURE_WINDOW_MS * 2) / 1000));
  }

  /** Trạng thái khoá theo tên đăng nhập chưa có trong CSDL. */
  async usernameLock(username: string): Promise<number | null> {
    const now = this.clock.now().getTime();
    const state = await this.read(username);
    if (state.lockedUntilMs === null || state.lockedUntilMs <= now) return null;
    return Math.ceil((state.lockedUntilMs - now) / 1000);
  }

  /** Ghi một lần thất bại; trả số lần liên tiếp và mốc khoá nếu vừa chạm ngưỡng. */
  async recordUsernameFailure(
    username: string,
    threshold: number,
    lockMs: number,
  ): Promise<AttemptState> {
    const now = this.clock.now().getTime();
    const key = this.usernameKey(username);
    const current = await this.read(username);
    const failures =
      current.lockedUntilMs !== null && current.lockedUntilMs <= now ? 1 : current.failures + 1;
    const lockedUntilMs = failures >= threshold ? now + lockMs : null;
    await this.redis.set(key, JSON.stringify({ failures, lockedUntilMs } satisfies AttemptState));
    return { failures, lockedUntilMs };
  }

  async clearUsername(username: string): Promise<void> {
    await this.redis.del(this.usernameKey(username));
  }

  private async read(username: string): Promise<AttemptState> {
    const raw = await this.redis.get(this.usernameKey(username));
    if (raw === null) return { failures: 0, lockedUntilMs: null };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null)
        return { failures: 0, lockedUntilMs: null };
      const failures = 'failures' in parsed ? Number(parsed.failures) : 0;
      const locked = 'lockedUntilMs' in parsed ? parsed.lockedUntilMs : null;
      return {
        failures: Number.isFinite(failures) ? failures : 0,
        lockedUntilMs: typeof locked === 'number' ? locked : null,
      };
    } catch {
      return { failures: 0, lockedUntilMs: null };
    }
  }
}
