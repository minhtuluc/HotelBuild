/**
 * Phần thuần cho SCR-51 (hàng đợi thông báo): quy tắc gửi lại (BR-SYS-06) và nhãn trạng thái/kênh.
 * Máy chủ vẫn là nơi chặn cuối; giao diện chỉ tắt nút khi chắc chắn không hợp lệ.
 */
import {
  NOTIFICATION_MAX_RESENDS,
  type NotificationChannel,
  type NotificationResendRequest,
  type NotificationSummary,
} from '@pinehill/contracts';

/** Hợp đồng chỉ xuất schema trạng thái, nên kiểu lấy từ chính DTO để không lệch nguồn. */
export type NotificationStatus = NotificationSummary['status'];

/** Khoảng cách tối thiểu giữa hai lần gửi lại (BR-SYS-06). */
export const RESEND_MIN_GAP_MS = 5 * 60_000;

export interface FieldIssue {
  field: string;
  issue: string;
}

export interface ResendState {
  allowed: boolean;
  reason: 'MAX_RETRIES' | 'TOO_SOON' | null;
}

/**
 * Nút gửi lại chỉ bật khi: chưa đủ số lần tối đa **và** lần thử gần nhất đã quá 5 phút.
 * Mốc lần thử gần nhất là `sentAt`, chưa gửi lần nào thì lấy `createdAt` (bản ghi vừa vào hàng đợi).
 */
export function resendState(notification: NotificationSummary, nowMs: number): ResendState {
  if (notification.retryCount >= NOTIFICATION_MAX_RESENDS) {
    return { allowed: false, reason: 'MAX_RETRIES' };
  }
  const lastAttemptMs = Date.parse(notification.sentAt ?? notification.createdAt);
  if (Number.isNaN(lastAttemptMs)) return { allowed: true, reason: null };
  return nowMs - lastAttemptMs < RESEND_MIN_GAP_MS
    ? { allowed: false, reason: 'TOO_SOON' }
    : { allowed: true, reason: null };
}

/** Lý do gửi lại là bắt buộc (hợp đồng `notificationResendRequestSchema`). */
export function resendIssues(reason: string): readonly FieldIssue[] {
  return reason.trim() === '' ? [{ field: 'reason', issue: 'REQUIRED' }] : [];
}

export function resendRequest(reason: string): NotificationResendRequest {
  return { reason: reason.trim() };
}

/** Nhãn trạng thái thông báo (BA-SYS-06: PENDING/SENT/FAILED). */
export const STATUS_LABEL_KEY: Readonly<Record<NotificationStatus, StatusLabelKey>> = {
  PENDING: 'enum.notiStatus.PENDING',
  SENT: 'enum.notiStatus.SENT',
  FAILED: 'enum.notiStatus.FAILED',
};

export type StatusLabelKey =
  'enum.notiStatus.PENDING' | 'enum.notiStatus.SENT' | 'enum.notiStatus.FAILED';

/** Nhãn kênh gửi (EMAIL/SMS/ZALO_OA/PUSH). */
export const CHANNEL_LABEL_KEY: Readonly<Record<NotificationChannel, ChannelLabelKey>> = {
  EMAIL: 'enum.notiChannel.EMAIL',
  SMS: 'enum.notiChannel.SMS',
  ZALO_OA: 'enum.notiChannel.ZALO_OA',
  PUSH: 'enum.notiChannel.PUSH',
};

export type ChannelLabelKey =
  | 'enum.notiChannel.EMAIL'
  | 'enum.notiChannel.SMS'
  | 'enum.notiChannel.ZALO_OA'
  | 'enum.notiChannel.PUSH';

/** Tham số tra cứu: chỉ gửi bộ lọc đã khai. */
export function notiParams(filters: {
  status: NotificationStatus | '';
  channel: NotificationChannel | '';
  template: string;
}): { status?: NotificationStatus; channel?: NotificationChannel; template?: string } {
  return {
    ...(filters.status === '' ? {} : { status: filters.status }),
    ...(filters.channel === '' ? {} : { channel: filters.channel }),
    ...(filters.template.trim() === '' ? {} : { template: filters.template.trim() }),
  };
}
