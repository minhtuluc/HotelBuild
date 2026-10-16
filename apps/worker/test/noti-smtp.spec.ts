import { describe, expect, test } from 'vitest';
import { loadWorkerConfig } from '../src/config/env.js';
import { renderMessage } from '../src/noti/message.js';
import { SmtpDeliveryError, smtpSend, smtpSettings } from '../src/noti/smtp.js';
import type { EmailMessage, SmtpSettings } from '../src/noti/smtp.js';
import { acceptAllScript, replyOnlyScript, startFakeSmtp } from './fake-smtp.js';
import type { SmtpTranscript } from './fake-smtp.js';

/**
 * HB-168 — kênh email chạy trên socket thật (máy chủ SMTP giả bằng `node:net`): bắt tay đầy đủ
 * EHLO → AUTH → MAIL/RCPT/DATA → QUIT, che CR/LF ở tiêu đề, dot-stuffing thân thư, và mã lỗi mạng ổn
 * định (không lộ chi tiết mạng/PII).
 */
const CONFIG_ENV = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

const MESSAGE: EmailMessage = {
  to: 'guest@example.test',
  subject: 'Xác nhận đặt phòng',
  body: 'Dòng một\r\n.\r\nDòng ba',
};

function settings(url: string, overrides: Partial<SmtpSettings> = {}): SmtpSettings {
  return { url, from: 'no-reply@pinehill.test', timeoutMs: 2_000, ...overrides };
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/** Một lượt gửi hỏng phải là `SmtpDeliveryError`; trả mã ổn định để khẳng định. */
async function failureCodeOf(attempt: Promise<void>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof SmtpDeliveryError) return error.code;
    throw error;
  }
  throw new Error('lượt gửi phải hỏng nhưng lại thành công');
}

describe('HB-168 · smtpSettings', () => {
  test('thiếu URL hoặc FROM ⇒ không có cấu hình (kênh email báo EMAIL_NOT_CONFIGURED)', () => {
    expect(smtpSettings(loadWorkerConfig(CONFIG_ENV))).toBeNull();
    expect(
      smtpSettings(loadWorkerConfig({ ...CONFIG_ENV, NOTI_SMTP_URL: 'smtp://127.0.0.1:1025' })),
    ).toBeNull();
    expect(
      smtpSettings(loadWorkerConfig({ ...CONFIG_ENV, NOTI_SMTP_FROM: 'no-reply@pinehill.test' })),
    ).toBeNull();
  });

  test('đủ URL + FROM ⇒ cấu hình dùng được, hạn gửi 10 giây', () => {
    const config = loadWorkerConfig({
      ...CONFIG_ENV,
      NOTI_SMTP_URL: 'smtp://127.0.0.1:1025',
      NOTI_SMTP_FROM: 'no-reply@pinehill.test',
    });
    expect(smtpSettings(config)).toEqual({
      url: 'smtp://127.0.0.1:1025',
      from: 'no-reply@pinehill.test',
      timeoutMs: 10_000,
    });
  });
});

describe('HB-168 · smtpSend', () => {
  test('gửi trọn lượt không AUTH: EHLO → MAIL/RCPT → DATA → QUIT', async () => {
    const server = await startFakeSmtp(acceptAllScript());
    try {
      await smtpSend(settings(server.url), MESSAGE);
    } finally {
      await server.close();
    }
    expect(server.lines).toContain('EHLO pinehill');
    expect(server.lines).toContain('MAIL FROM:<no-reply@pinehill.test>');
    expect(server.lines).toContain('RCPT TO:<guest@example.test>');
    expect(server.lines).toContain('QUIT');
    // Dot-stuffing: dòng thân chỉ có '.' phải được nhân đôi (RFC 5321 §4.5.2).
    expect(server.lines).toContain('..');
    expect(server.lines).toContain('Dòng ba');
  });

  test('tiêu đề chứa CR/LF bị làm phẳng, không chèn thêm header', async () => {
    const server = await startFakeSmtp(acceptAllScript());
    try {
      await smtpSend(settings(server.url), {
        ...MESSAGE,
        subject: 'Xin chào\r\nX-Injected: evil',
      });
    } finally {
      await server.close();
    }
    expect(server.lines).toContain('Subject: Xin chào  X-Injected: evil');
    expect(server.lines).not.toContain('X-Injected: evil');
  });

  test('AUTH LOGIN dùng userinfo đã giải mã (URL percent-encoding)', async () => {
    const server = await startFakeSmtp(acceptAllScript());
    const url = server.url.replace('smtp://', 'smtp://user%40name:p%40ss%3Aword@');
    try {
      await smtpSend(settings(url), MESSAGE);
    } finally {
      await server.close();
    }
    const authIndex = server.lines.indexOf('AUTH LOGIN');
    expect(authIndex).toBeGreaterThan(-1);
    expect(server.lines[authIndex + 1]).toBe(base64('user@name'));
    expect(server.lines[authIndex + 2]).toBe(base64('p@ss:word'));
  });

  test('AUTH LOGIN thiếu mật khẩu ⇒ gửi mật khẩu rỗng', async () => {
    const server = await startFakeSmtp(acceptAllScript());
    const url = server.url.replace('smtp://', 'smtp://chi-user@');
    try {
      await smtpSend(settings(url), MESSAGE);
    } finally {
      await server.close();
    }
    const authIndex = server.lines.indexOf('AUTH LOGIN');
    expect(server.lines[authIndex + 1]).toBe(base64('chi-user'));
    expect(server.lines[authIndex + 2]).toBe('');
  });

  test('URL sai scheme / thiếu host / cổng 0 ⇒ SMTP_URL_INVALID', async () => {
    expect(await failureCodeOf(smtpSend(settings('http://127.0.0.1:25'), MESSAGE))).toBe(
      'SMTP_URL_INVALID',
    );
    expect(await failureCodeOf(smtpSend(settings('smtp:///hop-thu'), MESSAGE))).toBe(
      'SMTP_URL_INVALID',
    );
    expect(await failureCodeOf(smtpSend(settings('smtp://127.0.0.1:0'), MESSAGE))).toBe(
      'SMTP_URL_INVALID',
    );
  });

  test('URL không phân tích được ⇒ lỗi thô để tầng kênh tự bọc lại', async () => {
    await expect(smtpSend(settings('không-phải-url'), MESSAGE)).rejects.toThrow(TypeError);
  });

  test('không ghi cổng ⇒ dùng cổng mặc định 587/465 và lỗi DNS có mã ổn định', async () => {
    expect(await failureCodeOf(smtpSend(settings('smtp://no-such-host.invalid'), MESSAGE))).toMatch(
      /^SMTP_(ENOTFOUND|EAI_AGAIN)$/,
    );
    expect(
      await failureCodeOf(smtpSend(settings('smtps://no-such-host.invalid'), MESSAGE)),
    ).toMatch(/^SMTP_(ENOTFOUND|EAI_AGAIN)$/);
  });

  test('máy chủ câm (không chào) ⇒ SMTP_TIMEOUT', async () => {
    const server = await startFakeSmtp(() => undefined, null);
    try {
      expect(await failureCodeOf(smtpSend(settings(server.url, { timeoutMs: 120 }), MESSAGE))).toBe(
        'SMTP_TIMEOUT',
      );
    } finally {
      await server.close();
    }
  });

  test('máy chủ đóng kết nối giữa lượt ⇒ SMTP_CONNECTION_CLOSED', async () => {
    const server = await startFakeSmtp((_line, socket) => socket.end());
    try {
      expect(await failureCodeOf(smtpSend(settings(server.url), MESSAGE))).toBe(
        'SMTP_CONNECTION_CLOSED',
      );
    } finally {
      await server.close();
    }
  });

  test('mã phản hồi ngoài dự kiến ⇒ SMTP_UNEXPECTED_<mã>', async () => {
    const server = await startFakeSmtp(replyOnlyScript('500 5.5.1 không hiểu\r\n'));
    try {
      expect(await failureCodeOf(smtpSend(settings(server.url), MESSAGE))).toBe(
        'SMTP_UNEXPECTED_500',
      );
    } finally {
      await server.close();
    }
  });

  test('phản hồi quá khổ, không có dòng kết thúc ⇒ SMTP_RESPONSE_TOO_LARGE', async () => {
    const server = await startFakeSmtp(() => undefined, 'x'.repeat(9000));
    try {
      expect(await failureCodeOf(smtpSend(settings(server.url), MESSAGE))).toBe(
        'SMTP_RESPONSE_TOO_LARGE',
      );
    } finally {
      await server.close();
    }
  });

  test('cổng không mở ⇒ SMTP_ECONNREFUSED', async () => {
    const closed = await startFakeSmtp(acceptAllScript());
    const url = closed.url;
    await closed.close();
    expect(await failureCodeOf(smtpSend(settings(url, { timeoutMs: 500 }), MESSAGE))).toBe(
      'SMTP_ECONNREFUSED',
    );
  });

  test('smtps tới máy chủ thường ⇒ hỏng bắt tay TLS nhưng vẫn là mã SMTP_*', async () => {
    const server = await startFakeSmtp(acceptAllScript());
    try {
      const url = server.url.replace('smtp://', 'smtps://');
      expect(await failureCodeOf(smtpSend(settings(url, { timeoutMs: 500 }), MESSAGE))).toMatch(
        /^SMTP_/,
      );
    } finally {
      await server.close();
    }
  });

  test('thân thư có LF trần ⇒ một khối DATA duy nhất, không dòng nội dung nào thành lệnh SMTP', async () => {
    const transcript: SmtpTranscript = { commands: [], data: [] };
    const server = await startFakeSmtp(acceptAllScript(transcript));
    // Nội dung do chính `renderMessage` dựng (nối bằng LF) từ các trường khách nhập được — đúng đường đi thật.
    const smuggled = 'MAIL FROM:<ke-gian@example.test>';
    const rendered = renderMessage({
      channel: 'EMAIL',
      recipient: 'guest@example.test',
      template: 'booking-confirmed',
      message: {
        guestName: `Khách\n.\n${smuggled}\nXong`,
        reason: 'Lý do\nRCPT TO:<ke-gian@example.test>',
      },
    });
    try {
      await smtpSend(settings(server.url), {
        to: 'guest@example.test',
        subject: rendered.subject,
        body: rendered.body,
      });
    } finally {
      await server.close();
    }
    // Đúng một khối DATA, và không dòng nào của thân thư trở thành dòng lệnh SMTP.
    expect(transcript.commands.filter((line) => line === 'DATA')).toHaveLength(1);
    expect(transcript.commands).not.toContain(smuggled);
    expect(transcript.commands).not.toContain('RCPT TO:<ke-gian@example.test>');
    // Dòng `.` sau LF trần được nhân đôi và nằm trong khối dữ liệu.
    expect(transcript.data).toContain('..');
    expect(transcript.data).toContain(smuggled);
    // Mọi kết thúc dòng trên đường truyền đều là CRLF: bỏ hết cặp CRLF thì không còn CR/LF nào.
    expect(server.raw().replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  test('dòng bắt đầu bằng "." sau LF trần được nhân đôi thành ".."', async () => {
    const transcript: SmtpTranscript = { commands: [], data: [] };
    const server = await startFakeSmtp(acceptAllScript(transcript));
    try {
      await smtpSend(settings(server.url), {
        to: 'guest@example.test',
        subject: 'x',
        body: 'Dòng một\n.dòng ẩn\n.\nDòng cuối',
      });
    } finally {
      await server.close();
    }
    expect(transcript.data).toContain('Dòng một');
    expect(transcript.data).toContain('..dòng ẩn');
    expect(transcript.data).toContain('..');
    expect(transcript.data).toContain('Dòng cuối');
    // Không dòng nào bị mất chữ đầu, và `.` trần không xuất hiện như một dòng dữ liệu.
    expect(transcript.data).not.toContain('.dòng ẩn');
    expect(transcript.data).not.toContain('.');
  });

  test('người nhận có LF trần không tạo được ranh giới lệnh', async () => {
    const transcript: SmtpTranscript = { commands: [], data: [] };
    const server = await startFakeSmtp(acceptAllScript(transcript));
    try {
      await smtpSend(settings(server.url), {
        to: 'guest@example.test\nRSET',
        subject: 'x',
        body: 'y',
      });
    } finally {
      await server.close();
    }
    expect(transcript.commands).toContain('RCPT TO:<guest@example.test RSET>');
    expect(transcript.commands).not.toContain('RSET');
  });
});
