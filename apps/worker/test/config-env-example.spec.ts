/**
 * HB-233 — worker cũng phải khởi động từ `.env` sao từ `.env.example`. Thử README máy sạch (HB-192) vấp
 * `Cấu hình thiếu/sai: EXPORT_DIR, NOTI_SMTP_URL, NOTI_SMTP_FROM` vì các dòng `KEY=` để trống.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config/env.js';

function envExample(): Record<string, string> {
  const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1');
  }
  return env;
}

describe('HB-233 cấu hình worker từ .env.example', () => {
  it('HB233_worker_boots_from_env_example', () => {
    const env = envExample();
    expect(env['NOTI_SMTP_URL']).toBe('');
    const config = loadWorkerConfig(env);
    expect(config.EXPORT_DIR).toBeUndefined();
    expect(config.NOTI_SMTP_URL).toBeUndefined();
  });
});
