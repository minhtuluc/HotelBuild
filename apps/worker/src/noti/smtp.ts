import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { WorkerConfig } from '../config/env.js';

/**
 * Gửi email qua SMTP bằng socket TCP/TLS thuần (RFC 5321): không thêm dependency vì
 * `apps/worker/package.json` đóng băng với HB-163 ngoài `bullmq`/`pino`/`zod`/`prisma`.
 *
 * Hỗ trợ `smtp://[user:pass@]host:port` và `smtps://…` (TLS ngầm định); có `AUTH LOGIN` khi URL
 * mang userinfo. Không có STARTTLS — triển khai ghi rõ trong README và chỉ dùng `smtps://`
 * cho SMTP công cộng. Không log địa chỉ nhận/tiêu đề/nội dung ở bất cứ đâu.
 */

export interface SmtpSettings {
  readonly url: string;
  readonly from: string;
  readonly timeoutMs: number;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/** Lỗi gửi có mã ổn định (`code`) để ghi `error_message` mà không mang chi tiết mạng/PII. */
export class SmtpDeliveryError extends Error {
  constructor(readonly code: string) {
    super(`gửi email thất bại (${code})`);
    this.name = 'SmtpDeliveryError';
  }
}

/**
 * Cấu hình kênh email lấy từ `WorkerConfig` (nơi DUY NHẤT đọc `process.env`). Thiếu
 * `NOTI_SMTP_URL`/`NOTI_SMTP_FROM` ⇒ kênh email lỗi ngay bằng `EMAIL_NOT_CONFIGURED`
 * (không giả vờ đã gửi).
 */
export function smtpSettings(config: WorkerConfig): SmtpSettings | null {
  const url = config.NOTI_SMTP_URL;
  const from = config.NOTI_SMTP_FROM;
  if (url === undefined || from === undefined) return null;
  return { url, from, timeoutMs: 10_000 };
}

interface SmtpTarget {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string | null;
  readonly password: string | null;
}

/** Cổng mặc định khi URL không ghi rõ: TLS ngầm định 465, STARTTLS-less 587. */
function smtpPort(parsed: URL, secure: boolean): number {
  if (parsed.port === '') return secure ? 465 : 587;
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new SmtpDeliveryError('SMTP_URL_INVALID');
  return port;
}

/** Xác nhận scheme hợp lệ và cho biết URL dùng TLS ngầm định hay không. */
function smtpSecure(protocol: string): boolean {
  if (protocol === 'smtp:') return false;
  if (protocol === 'smtps:') return true;
  throw new SmtpDeliveryError('SMTP_URL_INVALID');
}

function parseTarget(url: string): SmtpTarget {
  const parsed = new URL(url);
  const secure = smtpSecure(parsed.protocol);
  if (parsed.hostname === '') throw new SmtpDeliveryError('SMTP_URL_INVALID');
  return {
    host: parsed.hostname,
    port: smtpPort(parsed, secure),
    secure,
    username: parsed.username === '' ? null : decodeURIComponent(parsed.username),
    password: parsed.password === '' ? null : decodeURIComponent(parsed.password),
  };
}

const SOCKET_ERROR_CODES: readonly string[] = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
];

/** Chỉ mã socket đã biết mới lộ ra ngoài (kèm tiền tố `SMTP_`). */
function isKnownSocketCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  return SOCKET_ERROR_CODES.includes(code);
}

/** Mã lỗi mạng ổn định: chỉ các mã socket đã biết kèm tiền tố, còn lại một mã chung. */
function socketErrorCode(cause: unknown): string {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    isKnownSocketCode(cause.code)
  )
    return `SMTP_${cause.code}`;
  return 'SMTP_CONNECTION_FAILED';
}

interface SmtpResponse {
  readonly code: number;
  readonly text: string;
}

/**
 * Lấy một phản hồi đầy đủ khỏi bộ đệm: các dòng `250-…` là tiếp nối, dòng `250 …` kết thúc
 * (RFC 5321 §4.2). Chưa đủ dòng ⇒ `null` để đọc tiếp; dòng sai khuôn cũng đợi thêm — server nói
 * linh tinh sẽ bị timeout tổng ngắt thay vì làm treo worker.
 */
function takeResponse(buffer: string): { value: SmtpResponse; rest: string } | null {
  const lines: string[] = [];
  let rest = buffer;
  for (;;) {
    const end = rest.indexOf('\r\n');
    if (end < 0) return null;
    const line = rest.slice(0, end);
    rest = rest.slice(end + 2);
    lines.push(line);
    if (/^\d{3} /.test(line))
      return { value: { code: Number(line.slice(0, 3)), text: lines.join('\n') }, rest };
  }
}

/** Ép một giá trị vào **một dòng** lệnh/tiêu đề: CR/LF thành khoảng trắng (chống chèn lệnh/header). */
function oneLine(value: string): string {
  return value.replaceAll(/[\r\n]/g, ' ');
}

class SmtpSession {
  private buffer = '';
  private failure: SmtpDeliveryError | null = null;
  private waiter: {
    resolve: () => void;
    reject: (error: SmtpDeliveryError) => void;
  } | null = null;

  constructor(readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: Buffer | string) => {
      this.buffer += String(chunk);
      this.wake();
    });
    socket.on('timeout', () => {
      this.failure = new SmtpDeliveryError('SMTP_TIMEOUT');
      socket.destroy();
      this.wake();
    });
    socket.on('error', (cause: unknown) => {
      this.failure = new SmtpDeliveryError(socketErrorCode(cause));
      this.wake();
    });
    socket.on('close', () => {
      if (this.failure === null) this.failure = new SmtpDeliveryError('SMTP_CONNECTION_CLOSED');
      this.wake();
    });
  }

  private wake(): void {
    const waiter = this.waiter;
    if (waiter === null) return;
    this.waiter = null;
    if (this.failure !== null) waiter.reject(this.failure);
    else waiter.resolve();
  }

  private async readResponse(): Promise<SmtpResponse> {
    for (;;) {
      if (this.failure !== null) throw this.failure;
      const taken = takeResponse(this.buffer);
      if (taken !== null) {
        this.buffer = taken.rest;
        return taken.value;
      }
      if (this.buffer.length > 8192) throw new SmtpDeliveryError('SMTP_RESPONSE_TOO_LARGE');
      await new Promise<void>((resolve, reject) => {
        this.waiter = { resolve, reject };
      });
    }
  }

  async greet(expected: readonly number[]): Promise<void> {
    const response = await this.readResponse();
    if (!expected.includes(response.code))
      throw new SmtpDeliveryError(`SMTP_UNEXPECTED_${response.code}`);
  }

  async command(line: string, accepted: readonly number[]): Promise<void> {
    if (this.failure !== null) throw this.failure;
    this.socket.write(`${line}\r\n`);
    await this.greet(accepted);
  }

  /**
   * Gửi khối DATA đã dot-stuff: tiêu đề một dòng (xoá CR/LF chống chèn header), thân UTF-8 8bit **đã
   * chuẩn hoá kết thúc dòng về CRLF**, rồi đọc `250` kết thúc theo RFC 5321 §4.1.1.4.
   *
   * Bảo mật: `renderMessage` nối thân thư bằng LF mà nhiều máy chủ SMTP vẫn coi LF là kết thúc dòng, nên
   * một dòng `.` sau LF trần sẽ không được nhân đôi và có thể kết thúc `DATA` sớm — phần còn lại của nội
   * dung (`guestName`/`reason` chứa `\n`) thành lệnh SMTP (SMTP smuggling). Chuẩn hoá CRLF **trước** khi
   * tách dòng/dot-stuffing nên không còn LF (hay CR) trần nào trên đường truyền.
   */
  async sendData(from: string, message: EmailMessage): Promise<void> {
    const body = message.body.replaceAll(/\r\n|\r|\n/g, '\r\n');
    const payload = [
      `From: ${oneLine(from)}`,
      `To: ${oneLine(message.to)}`,
      `Subject: ${oneLine(message.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
    ]
      .join('\r\n')
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    if (this.failure !== null) throw this.failure;
    this.socket.write(`${payload}\r\n.\r\n`);
    await this.greet([250]);
  }
}

const base64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

/** Một lượt gửi email trọn vẹn: EHLO → AUTH (nếu có userinfo) → MAIL/RCPT/DATA → QUIT. */
export async function smtpSend(settings: SmtpSettings, message: EmailMessage): Promise<void> {
  const target = parseTarget(settings.url);
  const socket: Socket = target.secure
    ? tlsConnect({ host: target.host, port: target.port })
    : netConnect({ host: target.host, port: target.port });
  socket.setTimeout(settings.timeoutMs);
  const session = new SmtpSession(socket);
  try {
    await session.greet([220]);
    await session.command('EHLO pinehill', [250]);
    if (target.username !== null) {
      await session.command('AUTH LOGIN', [334]);
      await session.command(base64(target.username), [334]);
      await session.command(base64(target.password ?? ''), [235]);
    }
    await session.command(`MAIL FROM:<${oneLine(settings.from)}>`, [250]);
    await session.command(`RCPT TO:<${oneLine(message.to)}>`, [250, 251]);
    await session.command('DATA', [354]);
    await session.sendData(settings.from, message);
    await session.command('QUIT', [221, 250]);
  } finally {
    socket.destroy();
  }
}
