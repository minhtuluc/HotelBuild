import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { MailDeliveryError } from './mailer.js';
import type { MailMessage, Mailer } from './mailer.js';

/** Địa chỉ gửi mặc định cho dev; production đặt `SMTP_FROM`. */
export const DEFAULT_MAIL_FROM = 'Pine Hill <no-reply@localhost>';

/** Mã lỗi của thư viện nếu là chuỗi ngắn dạng `ECONNECTION`; còn lại gộp `SMTP_ERROR` (không lộ thông điệp thô). */
function safeCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(code)) return code;
  }
  return 'SMTP_ERROR';
}

/** Adapter SMTP bằng `nodemailer`; kết nối ngắn (timeout) để SMTP treo không giữ request lâu. */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = createTransport({
      url,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      throw new MailDeliveryError(safeCode(error));
    }
  }
}

/** Dùng khi chưa có `SMTP_URL`: mọi lần gửi lỗi `MAIL_NOT_CONFIGURED` để người gọi log + audit. */
export class UnconfiguredMailer implements Mailer {
  send(): Promise<void> {
    return Promise.reject(new MailDeliveryError('MAIL_NOT_CONFIGURED'));
  }
}
