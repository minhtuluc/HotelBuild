import { renderMessage, type NotificationChannel, type OutgoingMessage } from './message.js';
import { SmtpDeliveryError, smtpSend, type SmtpSettings } from './smtp.js';
/**
 * Cổng gửi của worker theo kênh. EMAIL dùng SMTP (`NOTI_SMTP_URL`/`NOTI_SMTP_FROM`, đọc lúc gửi);
 * SMS/ZALO_OA/PUSH là adapter **giả lập có chủ ý** (ticket HB-168 AC3): chưa có nhà cung cấp nên
 * không gọi mạng — adapter chỉ dựng nội dung và kiểm địa chỉ nhận rồi trả về.
 */

/** Lỗi kênh mang mã ổn định để ghi `error_message` mà không mang chi tiết mạng/PII. */
export class ChannelDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ChannelDeliveryError';
  }
}

export interface ChannelSender {
  send(message: OutgoingMessage): Promise<void>;
}

export type ChannelSenders = Readonly<Record<NotificationChannel, ChannelSender>>;

function emailSender(settings: SmtpSettings | null): ChannelSender {
  return {
    async send(message) {
      if (settings === null) throw new ChannelDeliveryError('EMAIL_NOT_CONFIGURED');
      const rendered = renderMessage(message);
      try {
        await smtpSend(settings, {
          to: message.recipient,
          subject: rendered.subject,
          body: rendered.body,
        });
      } catch (error) {
        if (error instanceof ChannelDeliveryError) throw error;
        if (error instanceof SmtpDeliveryError) throw new ChannelDeliveryError(error.code);
        throw new ChannelDeliveryError('EMAIL_DELIVERY_FAILED');
      }
    },
  };
}

function simulatedSender(channel: NotificationChannel): ChannelSender {
  return {
    async send(message) {
      renderMessage(message);
      if (message.recipient.trim() === '')
        throw new ChannelDeliveryError(`${channel}_RECIPIENT_INVALID`);
    },
  };
}

/**
 * Bộ gửi theo kênh. Cấu hình SMTP đi vào từ `WorkerConfig` (không đọc `process.env` ở đây); test bơm bộ
 * gửi giả qua `createNotificationSendJob`.
 */
export function channelSenders(settings: SmtpSettings | null): ChannelSenders {
  return {
    EMAIL: emailSender(settings),
    SMS: simulatedSender('SMS'),
    ZALO_OA: simulatedSender('ZALO_OA'),
    PUSH: simulatedSender('PUSH'),
  };
}
