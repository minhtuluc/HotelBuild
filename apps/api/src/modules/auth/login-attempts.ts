/**
 * Đếm thất bại đăng nhập (BR-RBAC-06) trên Redis:
 * - hạn mức **theo IP**: 10 lần đăng nhập trong 60 giây (dùng mốc thời gian thật từ `Clock`, không dựa TTL Redis);
 * - khoá theo **tên đăng nhập không tồn tại**: 5 lần liên tiếp → khoá 15 phút, cùng thông điệp như tài khoản thật.
 */
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Clock } from '@pinehill/domain';
import { CLOCK } from '../../infrastructure/ports.js';
import { REDIS } from '../../infrastructure/redis/redis.module.js';
import type { RedisClient } from '../../infrastructure/redis/redis.module.js';

/** Số lần đăng nhập tối đa cho mỗi IP trong một cửa sổ (api.md §1.2). */
export const IP_FAILURE_LIMIT = 10;
/** Cửa sổ đếm theo IP. */
export const IP_FAILURE_WINDOW_MS = 60_000;

interface AttemptState {
  failures: number;
  lockedUntilMs: number | null;
}

const attemptStateSchema = z
  .object({
    failures: z.number().int().nonnegative(),
    lockedUntilMs: z.number().finite().nullable(),
  })
  .strict();

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
    const count = Number(
      await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        1,
        this.ipKey(ip, this.windowIndex(now)),
        Math.ceil((IP_FAILURE_WINDOW_MS * 2) / 1000),
      ),
    );
    if (count <= IP_FAILURE_LIMIT) return null;
    const windowEnd = (this.windowIndex(now) + 1) * IP_FAILURE_WINDOW_MS;
    const remaining = Math.ceil((windowEnd - now) / 1000);
    return Math.min(Math.max(remaining, 1), Math.ceil(IP_FAILURE_WINDOW_MS / 1000));
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
  ): Promise<AttemptState & { alreadyLocked: boolean }> {
    const now = this.clock.now().getTime();
    const key = this.usernameKey(username);
    const raw = await this.redis.eval(
      `
      local raw=redis.call('GET',KEYS[1]);
      local current=raw and cjson.decode(raw) or {failures=0,lockedUntilMs=cjson.null};
      local now=tonumber(ARGV[1]); local lock=current.lockedUntilMs;
      if lock~=cjson.null and lock>now then current.alreadyLocked=true; return cjson.encode(current); end;
      local failures=(lock~=cjson.null and lock<=now) and 1 or (current.failures+1);
      local untilMs=failures>=tonumber(ARGV[2]) and (now+tonumber(ARGV[3])) or cjson.null;
      local result=cjson.encode({failures=failures,lockedUntilMs=untilMs});
      redis.call('SET',KEYS[1],result);
      return cjson.encode({failures=failures,lockedUntilMs=untilMs,alreadyLocked=false});
    `,
      1,
      key,
      now,
      threshold,
      lockMs,
    );
    if (typeof raw !== 'string') throw new Error('Invalid Redis login counter response');
    return attemptStateSchema.extend({ alreadyLocked: z.boolean() }).parse(JSON.parse(raw));
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
