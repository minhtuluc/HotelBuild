import { describe, expect, test, vi } from 'vitest';
import { ChannelDeliveryError, channelSenders } from '../src/noti/channels.js';
import type { OutgoingMessage } from '../src/noti/message.js';
import type { SmtpSettings } from '../src/noti/smtp.js';
import { acceptAllScript, startFakeSmtp } from './fake-smtp.js';

/**
 * HB-168 — cổng gửi theo kênh: EMAIL đi SMTP thật (tới máy chủ giả), ba kênh còn lại là adapter giả lập
 * có chủ ý (dựng nội dung + kiểm người nhận, không gọi mạng).
 */
const MESSAGE: OutgoingMessage = {
  channel: 'EMAIL',
  recipient: 'guest@example.test',
  template: 'booking-confirmed',
  message: { bookingCode: 'PH-1', guestName: 'Khách HB-168' },
};

function settings(url: string, timeoutMs = 2_000): SmtpSettings {
  return { url, from: 'no-reply@pinehill.test', timeoutMs };
}

/** Mọi lỗi kênh phải là `ChannelDeliveryError`; trả mã ổn định để khẳng định. */
async function failureCodeOf(attempt: Promise<void>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof ChannelDeliveryError) return error.code;
    throw error;
  }
  throw new Error('lượt gửi phải hỏng nhưng lại thành công');
}

describe('HB-168 · channelSenders', () => {
  test('EMAIL thiếu cấu hình SMTP ⇒ EMAIL_NOT_CONFIGURED (không giả vờ đã gửi)', async () => {
    const senders = channelSenders(null);
    expect(await failureCodeOf(senders.EMAIL.send(MESSAGE))).toBe('EMAIL_NOT_CONFIGURED');
  });

  test('kênh giả lập: người nhận rỗng ⇒ <KÊNH>_RECIPIENT_INVALID; có người nhận ⇒ gửi xong', async () => {
    const senders = channelSenders(null);
    for (const channel of ['SMS', 'ZALO_OA', 'PUSH'] as const) {
      expect(
        await failureCodeOf(senders[channel].send({ ...MESSAGE, channel, recipient: '   ' })),
      ).toBe(`${channel}_RECIPIENT_INVALID`);
      await expect(
        senders[channel].send({ ...MESSAGE, channel, recipient: '+84900000168' }),
      ).resolves.toBeUndefined();
    }
  });

  test('EMAIL có cấu hình ⇒ gửi trọn lượt qua SMTP', async () => {
    const server = await startFakeSmtp(acceptAllScript());
    try {
      await expect(
        channelSenders(settings(server.url)).EMAIL.send(MESSAGE),
      ).resolves.toBeUndefined();
      expect(server.lines).toContain('RCPT TO:<guest@example.test>');
    } finally {
      await server.close();
    }
  });

  test('EMAIL: lỗi SMTP được đổi thành mã kênh ổn định', async () => {
    const closed = await startFakeSmtp(acceptAllScript());
    const url = closed.url;
    await closed.close();
    expect(await failureCodeOf(channelSenders(settings(url, 500)).EMAIL.send(MESSAGE))).toBe(
      'SMTP_ECONNREFUSED',
    );
  });

  test('EMAIL: lỗi ngoài SMTP ⇒ EMAIL_DELIVERY_FAILED (không lộ chi tiết)', async () => {
    expect(
      await failureCodeOf(channelSenders(settings('không-phải-url', 100)).EMAIL.send(MESSAGE)),
    ).toBe('EMAIL_DELIVERY_FAILED');
  });

  test('EMAIL: lỗi kênh do tầng SMTP ném ra được giữ nguyên mã', async () => {
    vi.resetModules();
    let errorFactory: () => Error = () => new Error('chưa sẵn sàng');
    vi.doMock('../src/noti/smtp.js', () => ({
      SmtpDeliveryError: class MockSmtpDeliveryError extends Error {},
      smtpSend: async () => {
        throw errorFactory();
      },
    }));
    try {
      // Import động là bắt buộc: `vi.doMock` chỉ áp cho module nạp **sau** `vi.resetModules()`.
      const fresh = await import('../src/noti/channels.js');
      errorFactory = () => new fresh.ChannelDeliveryError('SMTP_MOCKED');
      await expect(
        fresh.channelSenders(settings('smtp://127.0.0.1:1', 1_000)).EMAIL.send(MESSAGE),
      ).rejects.toThrow('SMTP_MOCKED');
    } finally {
      vi.doUnmock('../src/noti/smtp.js');
      vi.resetModules();
    }
  });
});
