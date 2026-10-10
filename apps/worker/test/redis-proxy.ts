import { createConnection, createServer } from 'node:net';
import type { Socket } from 'node:net';

/** Cắt đúng đường TCP của ca thử; Redis thật và các client khác không bị dừng. */
export async function redisProxy(redisUrl: string) {
  const upstream = new URL(redisUrl);
  if (upstream.protocol !== 'redis:') throw new Error('Proxy thử nghiệm cần Redis TCP');
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const remote = createConnection({
      host: upstream.hostname,
      port: Number(upstream.port) || 6379,
    });
    for (const socket of [client, remote]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    }
    client.on('error', () => remote.destroy());
    remote.on('error', () => client.destroy());
    client.on('close', () => remote.destroy());
    remote.on('close', () => client.destroy());
    client.pipe(remote).pipe(client);
  });
  async function listen(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  }
  async function cut(): Promise<void> {
    const closed = server.listening
      ? new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      : Promise.resolve();
    for (const socket of sockets) socket.destroy();
    await closed;
  }
  await listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy cần cổng TCP');
  const port = address.port;
  const url = new URL(redisUrl);
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return {
    url: url.toString(),
    cut,
    restore: async () => {
      if (!server.listening) await listen(port);
    },
    close: cut,
  };
}
