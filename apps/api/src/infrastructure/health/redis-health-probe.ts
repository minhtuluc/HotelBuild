import { connect } from 'node:net';
import type { HealthProbe } from './health-probe.js';

/** Lệnh RESP dạng mảng: mật khẩu chứa khoảng trắng/ký tự đặc biệt vẫn an toàn. */
function resp(...parts: readonly string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}

/**
 * Kiểm tra Redis bằng `PING`/`+PONG` qua socket thô (không kéo client Redis). HB-175: Redis production có
 * mật khẩu (`redis://[:user]:pass@host`), nên gửi `AUTH` trước `PING`. Trước đây probe luôn nhận
 * `-NOAUTH` ⇒ `/system/health` 503 vĩnh viễn trên mọi Redis có mật khẩu.
 */
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
      let received = '';
      socket.on('connect', () => socket.write(`${endpoint.auth}${resp('PING')}`));
      socket.on('data', (chunk) => {
        received += chunk.toString();
        // Lỗi (`-NOAUTH`, `-WRONGPASS`…) ⇒ down; `+OK` của AUTH rồi `+PONG` ⇒ up.
        if (received.startsWith('-') || received.includes('\r\n-')) finish(false);
        else if (received.includes('+PONG')) finish(true);
      });
      socket.on('error', () => finish(false));
      socket.on('timeout', () => finish(false));
      socket.on('end', () => finish(false));
      socket.on('close', () => finish(false));
    });
  }

  private parseEndpoint(): { host: string; port: number; auth: string } | undefined {
    try {
      const url = new URL(this.url);
      const password = decodeURIComponent(url.password);
      const username = decodeURIComponent(url.username);
      const auth =
        password === ''
          ? ''
          : username === ''
            ? resp('AUTH', password)
            : resp('AUTH', username, password);
      return { host: url.hostname, port: Number(url.port) || 6379, auth };
    } catch {
      return undefined;
    }
  }
}
