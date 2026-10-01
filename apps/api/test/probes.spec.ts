import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { PostgresHealthProbe } from '../src/infrastructure/health/postgres-health-probe.js';
import { RedisHealthProbe } from '../src/infrastructure/health/redis-health-probe.js';

const okClient = () => ({
  connect: () => Promise.resolve(),
  query: () => Promise.resolve({}),
  end: () => Promise.resolve(),
});
const badClient = () => ({
  connect: () => Promise.reject(new Error('down')),
  query: () => Promise.resolve({}),
  end: () => Promise.resolve(),
});

async function listen(
  handler: (socket: Socket) => void,
): Promise<{ port: number; close: () => void }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { port, close: () => server.close() };
}

describe('PostgresHealthProbe', () => {
  it('up khi select 1 thành công', async () => {
    expect(await new PostgresHealthProbe('unused', okClient).check()).toBe(true);
  });
  it('down khi connect thất bại', async () => {
    expect(await new PostgresHealthProbe('unused', badClient).check()).toBe(false);
  });
});

describe('RedisHealthProbe', () => {
  it('up khi nhận +PONG', async () => {
    const server = await listen((socket) => socket.on('data', () => socket.write('+PONG\r\n')));
    expect(await new RedisHealthProbe(`redis://127.0.0.1:${server.port}`).check()).toBe(true);
    server.close();
  });
  it('down khi peer đóng không PONG', async () => {
    const server = await listen((socket) => socket.end());
    expect(await new RedisHealthProbe(`redis://127.0.0.1:${server.port}`).check()).toBe(false);
    server.close();
  });
  it('down khi không phản hồi (timeout)', async () => {
    const server = await listen(() => undefined);
    expect(await new RedisHealthProbe(`redis://127.0.0.1:${server.port}`).check()).toBe(false);
    server.close();
  });
  it('down khi URL không parse được', async () => {
    expect(await new RedisHealthProbe('not-a-url').check()).toBe(false);
  });
});
