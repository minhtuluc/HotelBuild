import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';

/**
 * Máy chủ SMTP giả bằng TCP thuần (`node:net`) cho test worker: ghi lại **mọi dòng** nhận được và trả lời
 * theo kịch bản của từng ca. Máy chủ này **chịu LF trần** như nhiều MTA thật (tách dòng theo
 * `/\r\n|\n|\r/`), nhờ vậy test mô phỏng đúng kịch bản SMTP smuggling cần chặn.
 */
export interface FakeSmtp {
  readonly url: string;
  /** Mọi dòng đã tách (một dòng LF trần cũng thành một dòng ở đây). */
  readonly lines: string[];
  /** Toàn bộ bytes đã nhận — dùng để khẳng định ranh giới dòng trên đường truyền. */
  raw(): string;
  close(): Promise<void>;
}

/** Kịch bản nhận một dòng từ client và tự quyết định ghi gì lại (hoặc không ghi). */
export type SmtpScript = (line: string, socket: Socket) => void;

/** Bản ghi tách dòng lệnh khỏi khối `DATA` (dòng kết thúc `.` không nằm trong cả hai danh sách). */
export interface SmtpTranscript {
  readonly commands: string[];
  readonly data: string[];
}

/** Ranh giới dòng chịu được cả LF trần; thứ tự nhánh để `\r\n` không bị tách thành hai dòng. */
const NEWLINE = /\r\n|\n|\r/;

/** `greeting = null` để dựng ca "server câm" (client phải tự hết hạn). */
export async function startFakeSmtp(
  script: SmtpScript,
  greeting: string | null = '220 fake ESMTP\r\n',
): Promise<FakeSmtp> {
  const lines: string[] = [];
  const sockets: Socket[] = [];
  let received = '';
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    if (greeting !== null) socket.write(greeting);
    let buffer = '';
    socket.on('data', (chunk: string) => {
      received += chunk;
      buffer += chunk;
      for (;;) {
        const match = NEWLINE.exec(buffer);
        if (match === null) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        lines.push(line);
        script(line, socket);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('fake SMTP không lấy được cổng đã mở');
  return {
    url: `smtp://127.0.0.1:${address.port}`,
    lines,
    raw: () => received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Trả lời cho các lệnh không phụ thuộc trạng thái (khớp theo tiền tố). */
const COMMAND_REPLIES: readonly (readonly [string, string])[] = [
  ['EHLO pinehill', '250-fake\r\n250-SIZE 1024\r\n250 HELP\r\n'],
  ['MAIL FROM:', '250 2.1.0 ok\r\n'],
  ['RCPT TO:', '251 2.1.5 ok\r\n'],
  ['QUIT', '221 2.0.0 bye\r\n'],
];

interface SmtpConnectionState {
  authStep: number;
  inData: boolean;
}

/** Trả lời một dòng lệnh ngoài khối `DATA` (EHLO/AUTH/MAIL/RCPT/DATA/QUIT). */
function replyToCommand(line: string, socket: Socket, state: SmtpConnectionState): void {
  if (line === 'DATA') {
    state.inData = true;
    socket.write('354 gửi dữ liệu đi\r\n');
    return;
  }
  if (line === 'AUTH LOGIN') {
    state.authStep = 1;
    socket.write('334 VXNlcm5hbWU6\r\n');
    return;
  }
  if (state.authStep === 1) {
    state.authStep = 2;
    socket.write('334 UGFzc3dvcmQ6\r\n');
    return;
  }
  if (state.authStep === 2) {
    state.authStep = 3;
    socket.write('235 2.7.0 ok\r\n');
    return;
  }
  const matched = COMMAND_REPLIES.find(([prefix]) => line.startsWith(prefix));
  socket.write(matched === undefined ? '500 5.5.1 lệnh lạ\r\n' : matched[1]);
}

/**
 * Kịch bản SMTP hợp lệ: EHLO trả lời nhiều dòng (đúng RFC 5321 §4.2), `AUTH LOGIN` ba bước, và chế độ
 * `DATA` chỉ trả lời khi gặp dòng kết thúc `.`. `transcript` (tuỳ chọn) tách dòng lệnh khỏi khối dữ liệu
 * để test khẳng định ranh giới đường truyền.
 */
export function acceptAllScript(transcript?: SmtpTranscript): SmtpScript {
  const state: SmtpConnectionState = { authStep: 0, inData: false };
  return (line, socket) => {
    if (state.inData && line !== '.') {
      transcript?.data.push(line);
      return;
    }
    if (state.inData) {
      state.inData = false;
      socket.write('250 queued\r\n');
      return;
    }
    transcript?.commands.push(line);
    replyToCommand(line, socket, state);
  };
}

/** Trả lời cố định cho **mọi** dòng (dùng cho ca sai mã phản hồi / đóng kết nối / quá khổ). */
export function replyOnlyScript(reply: string): SmtpScript {
  return (_line, socket) => socket.write(reply);
}
