import { connect } from 'node:net';
import type { HealthProbe } from './health-probe.js';

/** Kiểm tra Redis bằng lệnh `PING`/`+PONG` qua socket thô (không kéo client Redis — ngoài phạm vi HB-004). */
export class RedisHealthProbe implements HealthProbe {
  readonly name = 'redis';

  constructor(private readonly url: string) {}

  async check(): Promise<boolean> {
    const endpoint = this.parseEndpoint();
    if (endpoint === undefined) return false;
    return await new Promise<boolean>((resolve) => {
      const socket = connect({ host: endpoint.host, port: endpoint.port });
      socket.setTimeout(1000);
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(ok);
      };
      socket.on('connect', () => socket.write('PING\r\n'));
      socket.on('data', (chunk) => finish(chunk.toString().startsWith('+PONG')));
      socket.on('error', () => finish(false));
      socket.on('timeout', () => finish(false));
    });
  }

  private parseEndpoint(): { host: string; port: number } | undefined {
    try {
      const url = new URL(this.url);
      return { host: url.hostname, port: Number(url.port) || 6379 };
    } catch {
      return undefined;
    }
  }
}
