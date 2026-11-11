/**
 * HB-233 — `.env` sao từ `.env.example` (chỉ sinh hai khoá JWT như chú thích trong tệp) phải khởi động
 * được API. README "dựng trên máy sạch" (HB-192) chạy thử đã vấp `Cấu hình thiếu/sai: EXPORT_DIR`: dòng
 * `EXPORT_DIR=` để trống nghĩa là "dùng mặc định" nhưng schema từ chối chuỗi rỗng.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

/** Đọc `.env.example` như `set -a; . ./.env` (KEY=VALUE, bỏ dấu nháy kép bao ngoài). */
function envExample(): Record<string, string> {
  const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1');
  }
  return env;
}

describe('HB-233 cấu hình API từ .env.example', () => {
  it('HB233_api_boots_from_env_example_with_generated_jwt_secrets', () => {
    const env: Record<string, string> = {
      ...envExample(),
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
    };
    expect(env['EXPORT_DIR']).toBe('');
    const config = loadConfig(env);
    expect(config.EXPORT_DIR).toBeUndefined();
    expect(config.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('HB233_empty_required_value_still_reports_missing_name', () => {
    expect(() =>
      loadConfig({ ...envExample(), JWT_ACCESS_SECRET: '', JWT_REFRESH_SECRET: '  ' }),
    ).toThrow(/JWT_ACCESS_SECRET, JWT_REFRESH_SECRET/);
  });
});
