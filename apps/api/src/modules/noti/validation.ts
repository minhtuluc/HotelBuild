import { z } from 'zod';
import {
  isoUtcTimestampSchema,
  notificationQuerySchema,
  notificationResendRequestSchema,
  notificationStatusSchema,
  type NotificationChannel,
  type NotificationResendRequest,
} from '@pinehill/contracts';
import { invalid, uuid } from '../inv/allotments/validation.js';

type Channel = NotificationChannel;
type Status = z.infer<typeof notificationStatusSchema>;

/**
 * Lọc danh sách trên `notificationQuerySchema` (HB-160) + siết chặt định dạng ở máy chủ:
 * UUID chuẩn thường, mốc `from`/`to` là ISO-8601 UTC với `from < to`. `sort` theo khuôn repo:
 * các module đọc hiện có đều giữ thứ tự mặc định của tài nguyên nên `sort` được nhận mà không đổi
 * thứ tự (`created_at` giảm dần rồi `id` giảm dần) — xem README.
 */
const querySchema = notificationQuerySchema.extend({
  bookingId: z
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
  cursor: z
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
  from: isoUtcTimestampSchema.optional(),
  to: isoUtcTimestampSchema.optional(),
});

export interface NotificationListInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly bookingId?: string;
  readonly channel?: Channel;
  readonly status?: Status;
  readonly template?: string;
  readonly from?: string;
  readonly to?: string;
  readonly q?: string;
}

type ParsedQuery = z.infer<typeof querySchema>;

/**
 * Kiểm thứ tự khoảng thời gian trên dữ liệu đã parse: `from`/`to` (nếu có) phải cùng chiều thời
 * gian. Sai thứ tự ⇒ cùng mã lỗi 400 như mọi đầu vào hỏng khác.
 */
function assertRangeOrder(from: string | undefined, to: string | undefined): void {
  if (from !== undefined && to !== undefined && Date.parse(from) >= Date.parse(to)) throw invalid();
}

/** Dựng `NotificationListInput` từ dữ liệu hợp lệ, chỉ mang các khóa tùy chọn có mặt. */
function toListInput(data: ParsedQuery): NotificationListInput {
  return {
    limit: data.limit,
    ...(data.cursor === undefined ? {} : { cursor: data.cursor }),
    ...(data.bookingId === undefined ? {} : { bookingId: data.bookingId }),
    ...(data.channel === undefined ? {} : { channel: data.channel }),
    ...(data.status === undefined ? {} : { status: data.status }),
    ...(data.template === undefined ? {} : { template: data.template }),
    ...(data.from === undefined ? {} : { from: data.from }),
    ...(data.to === undefined ? {} : { to: data.to }),
    ...(data.q === undefined ? {} : { q: data.q }),
  };
}

export function notificationListInput(value: unknown): NotificationListInput {
  const result = querySchema.safeParse(value);
  if (!result.success) throw invalid();
  assertRangeOrder(result.data.from, result.data.to);
  return toListInput(result.data);
}

/** Đường dẫn `POST /notifications/{notificationId}/resend`: id xấu cũng là 400, không lộ 404. */
export function notificationId(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  return uuid(value);
}

/** Thân gửi lại: `reason` bắt buộc (HB-160); strict nên không nhận trường lạ. */
export function resendInput(value: unknown): NotificationResendRequest {
  const result = notificationResendRequestSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}
