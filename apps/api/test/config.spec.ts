import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { run } from '../src/main.js';

const validEnv = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
};

describe('loadConfig', () => {
  it('đọc đủ biến và áp giá trị mặc định', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(cfg.IDEMPOTENCY_TTL_HOURS).toBe(24);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.PORT).toBe(3000);
  });

  it('thiếu biến bắt buộc → ConfigError nêu tên biến', () => {
    let caught: unknown;
    try {
      loadConfig({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    if (caught instanceof ConfigError) {
      expect(caught.message).toContain('DATABASE_URL');
      expect(caught.message).toContain('JWT_ACCESS_SECRET');
    }
  });

  it('không in giá trị bí mật trong thông điệp lỗi', () => {
    let caught: unknown;
    try {
      loadConfig({
        ...validEnv,
        JWT_REFRESH_SECRET: 'topsecret-value',
        JWT_ACCESS_SECRET: undefined,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const message = caught instanceof ConfigError ? caught.message : '';
    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).not.toContain('topsecret-value');
  });
});

describe('run', () => {
  it('trả mã 1 khi thiếu biến bắt buộc (không khởi động tiến trình)', async () => {
    expect(await run({})).toBe(1);
  });
});
