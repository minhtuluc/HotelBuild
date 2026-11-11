/**
 * HB-175 / TD-71 — API sau Caddy: `TRUST_PROXY_HOPS=1` tin đúng **một** hop proxy gần nhất, nên
 * `request.ip` là IP khách mà Caddy ghi vào cuối `X-Forwarded-For`. Giá trị khách tự khai đứng trước bị bỏ
 * qua, không giả IP để vượt hạn mức được. Vắng hoặc 0: không tin header nào.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { trustProxyOf } from '../src/main.js';

const opened: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((app) => app.close()));
});

async function ipSeen(hops: number | undefined, forwardedFor?: string): Promise<string> {
  const app = Fastify({ trustProxy: trustProxyOf(hops) });
  opened.push(app);
  app.get('/ip', (request) => ({ ip: request.ip }));
  const response = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '172.18.0.5', // Caddy trong mạng compose
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  });
  return response.json<{ ip: string }>().ip;
}

describe('HB-175 trustProxy theo số hop', () => {
  it('HB175_one_hop_uses_client_ip_appended_by_proxy_not_spoofed_value', async () => {
    // Khách gửi XFF giả "6.6.6.6"; Caddy nối IP kết nối thật của khách vào cuối.
    expect(await ipSeen(1, '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('HB175_without_hops_forwarded_header_is_ignored', async () => {
    expect(await ipSeen(undefined, '6.6.6.6')).toBe('172.18.0.5');
    expect(await ipSeen(0, '6.6.6.6')).toBe('172.18.0.5');
  });

  it('HB175_config_accepts_0_to_5_hops_only', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
      REDIS_URL: 'redis://127.0.0.1:6379',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      BUSINESS_TIMEZONE: 'Asia/Ho_Chi_Minh',
    };
    expect(loadConfig({ ...base, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    expect(loadConfig(base).TRUST_PROXY_HOPS).toBeUndefined();
    expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: 'true' })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: '9' })).toThrow(/TRUST_PROXY_HOPS/);
  });
});
