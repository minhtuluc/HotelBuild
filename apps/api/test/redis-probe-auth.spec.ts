/**
 * HB-175 — health probe Redis phải `AUTH` khi URL có mật khẩu. Dựng compose production (Redis
 * `--requirepass`) cho thấy `/system/health` 503 vĩnh viễn: probe gửi `PING` không xác thực ⇒ `-NOAUTH`.
 * Máy chủ giả dưới đây đòi đúng mật khẩu (kể cả ký tự đặc biệt) trước `PING`.
 */
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RedisHealthProbe } from '../src/infrastructure/health/redis-health-probe.js';

const PASSWORD = 'p@ss word:/#x';
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

/** Redis tối giản: đọc lệnh RESP, cần `AUTH <PASSWORD>` (hoặc `AUTH default <PASSWORD>`) trước `PING`. */
async function fakeRedis(): Promise<number> {
  const server = createServer((socket) => {
    let authed = false;
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const commands = buffer.split('*').filter((part) => part.includes('\r\n'));
      buffer = '';
      for (const command of commands) {
        const words = command.split('\r\n').filter((_, index) => index > 0 && index % 2 === 0);
        if (words[0] === 'AUTH') {
          authed = words[words.length - 1] === PASSWORD;
          socket.write(authed ? '+OK\r\n' : '-WRONGPASS invalid username-password pair\r\n');
        } else if (words[0] === 'PING') {
          socket.write(authed ? '+PONG\r\n' : '-NOAUTH Authentication required.\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => server.close());
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

describe('HB-175 RedisHealthProbe với mật khẩu', () => {
  it('HB175_probe_authenticates_with_url_password', async () => {
    const port = await fakeRedis();
    const url = `redis://:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port}/0`;
    expect(await new RedisHealthProbe(url).check()).toBe(true);
    const withUser = `redis://default:${encodeURIComponent(PASSWORD)}@127.0.0.1:${port}/0`;
    expect(await new RedisHealthProbe(withUser).check()).toBe(true);
  });

  it('HB175_probe_is_down_without_or_with_wrong_password', async () => {
    const port = await fakeRedis();
    expect(await new RedisHealthProbe(`redis://127.0.0.1:${port}`).check()).toBe(false);
    expect(await new RedisHealthProbe(`redis://:wrong@127.0.0.1:${port}`).check()).toBe(false);
  });
});
