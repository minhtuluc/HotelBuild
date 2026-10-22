import { z } from 'zod';

/** Kênh gửi (khớp `CHECK (channel ...)` và enum hợp đồng HB-160). */
export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'ZALO_OA', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
/**
 * Nội dung thông báo (`notifications.payload_json`) — gương của
 * `apps/api/src/modules/noti/message.ts` (hai package không dùng chung được).
 * `strictObject` nên khóa lạ bị từ chối ở lúc ghi, không lọt thành nội dung gửi khách.
 */
const messageSchema = z.strictObject({
  guestName: z.string().min(1).max(120).optional(),
  bookingCode: z.string().min(1).max(40).optional(),
  checkIn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  checkOut: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  amountVnd: z.number().int().min(0).optional(),
  reason: z.string().min(1).max(500).optional(),
});

export type NotificationMessage = z.infer<typeof messageSchema>;

export interface OutgoingMessage {
  readonly channel: NotificationChannel;
  readonly recipient: string;
  readonly template: string;
  readonly message: NotificationMessage;
}

/** Chuỗi hiển thị tiền VND cho nội dung thư — số nguyên, không phụ thuộc locale của máy chạy. */
function formatVnd(amount: number): string {
  return `${amount.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, '.')} VND`;
}

/** Tiêu đề thư theo mẫu; mẫu lạ giữ nguyên tên (không đoán), nội dung vẫn gửi đủ dữ kiện. */
/** HB-182 — cảnh báo vận hành gửi nhân viên (không phải thông báo cho khách). */
const ALERT_SUBJECTS: Readonly<Record<string, string>> = {
  'alert-room-conflict': 'Cảnh báo: xung đột gán phòng — Pine Hill',
  'alert-inventory-overbook': 'Cảnh báo: tồn kênh bán vượt hạn mức — Pine Hill',
  'alert-channel-degraded': 'Cảnh báo: kênh đồng bộ suy giảm — Pine Hill',
  'alert-login-abnormal': 'Cảnh báo: đăng nhập bất thường — Pine Hill',
  'alert-refund-sla': 'Cảnh báo: hoàn tiền quá hạn cam kết — Pine Hill',
};

function subjectOf(template: string, message: NotificationMessage): string {
  const code = message.bookingCode === undefined ? '' : ` [${message.bookingCode}]`;
  if (template === 'booking-confirmed') return `Xác nhận đặt phòng${code} — Pine Hill`;
  if (template === 'booking-cancelled') return `Xác nhận huỷ đặt phòng${code} — Pine Hill`;
  if (template === 'refund-paid') return `Thông báo hoàn tiền${code} — Pine Hill`;
  if (template === 'room-moved') return `Thông báo đổi phòng${code} — Pine Hill`;
  if (template === 'payment-confirmed') return `Xác nhận thanh toán${code} — Pine Hill`;
  return ALERT_SUBJECTS[template] ?? `Thông báo từ Pine Hill (${template})`;
}

function stayLine(message: NotificationMessage): string | null {
  if (message.checkIn === undefined || message.checkOut === undefined) return null;
  return `Lưu trú: ${message.checkIn} → ${message.checkOut}.`;
}

/** Thư văn bản thuần gửi theo kênh; chỉ nhận các trường đã biết của message, không dump JSON. */
export function renderMessage(input: OutgoingMessage): { subject: string; body: string } {
  if (input.template.startsWith('alert-')) {
    const reason = input.message.reason ?? 'Chi tiết đã ghi trong nhật ký kiểm toán Pine Hill.';
    return {
      subject: subjectOf(input.template, input.message),
      body: [
        'Pine Hill — cảnh báo vận hành —',
        reason,
        'Mở bảng điều khiển vận hành để xem và xử lý.',
      ].join('\n'),
    };
  }
  const lines: string[] = [];
  if (input.message.guestName !== undefined) lines.push(`Kính gửi ${input.message.guestName},`);
  const stay = stayLine(input.message);
  if (stay !== null) lines.push(stay);
  if (input.message.amountVnd !== undefined)
    lines.push(`Số tiền: ${formatVnd(input.message.amountVnd)}.`);
  if (input.message.reason !== undefined) lines.push(`Lý do: ${input.message.reason}.`);
  if (input.message.bookingCode !== undefined)
    lines.push(`Mã đặt phòng: ${input.message.bookingCode}.`);
  if (lines.length === 0) lines.push('Chi tiết thông báo đã ghi trong hệ thống Pine Hill.');
  return {
    subject: subjectOf(input.template, input.message),
    body: ['Pine Hill —', ...lines].join('\n'),
  };
}

/** Phân tích `payload_json` của hàng CSDL thành message; khóa lạ/thiếu kiểu ⇒ lỗi gửi an toàn. */
export function parseOutgoingMessage(
  channel: NotificationChannel,
  recipient: string,
  template: string,
  payload: unknown,
): OutgoingMessage {
  const message = messageSchema.safeParse(payload);
  if (!message.success) throw new Error('NOTIFICATION_MESSAGE_INVALID');
  return { channel, recipient, template, message: message.data };
}
