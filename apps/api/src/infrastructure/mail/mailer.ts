/**
 * Cổng gửi thư giao dịch của API (HB-028). Chỉ biết người nhận, tiêu đề và nội dung văn bản; adapter cụ thể
 * (SMTP/giả lập) nằm sau `MAILER`. Lỗi gửi luôn là `MailDeliveryError` với **mã** an toàn — không mang địa chỉ
 * người nhận, nội dung thư hay thông điệp thô của thư viện (NFR-SEC-03).
 */
export const MAILER = Symbol('MAILER');

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class MailDeliveryError extends Error {
  constructor(readonly code: string) {
    super(`Mail delivery failed: ${code}`);
    this.name = 'MailDeliveryError';
  }
}
