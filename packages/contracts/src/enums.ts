/**
 * Enum canonical — nguồn chân lý: docs/00-tong-quan.md §7.8.
 * Không định nghĩa lại giá trị ở nơi khác; đổi enum phải đổi tài liệu gốc trước.
 */
import { z } from 'zod';

export const bookingStatusSchema = z.enum([
  'DRAFT',
  'HELD',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
]);

export const cancelReasonSchema = z.enum([
  'GUEST_REQUEST',
  'FORCE_MAJEURE',
  'HOTEL_RELOCATION',
  'PAYMENT_TIMEOUT',
  'DUPLICATE',
  'NO_SHOW',
  'SYSTEM',
  'OTA_CANCELLATION',
  'EARLY_CHECKOUT',
]);

export const roomStatusSchema = z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']);

export const roomBlockReasonSchema = z.enum([
  'MAINTENANCE',
  'RENOVATION',
  'OWNER_USE',
  'DEEP_CLEAN',
]);

export const housekeepingStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'INSPECTED']);

export const channelCodeSchema = z.enum([
  'WEB',
  'PHONE',
  'WALKIN',
  'OTA_BOOKING',
  'OTA_AGODA',
  'OTA_AIRBNB',
  'AGENCY',
]);

export const ratePlanCodeSchema = z.enum(['FLEX7', 'SAVER3', 'NONREF', 'LONGSTAY14']);

export const rateSourceSchema = z.enum(['BASE', 'SEASON', 'OVERRIDE', 'RATE_PLAN']);

export const promotionTypeSchema = z.enum(['PERCENT', 'AMOUNT']);

export const paymentTypeSchema = z.enum([
  'DEPOSIT',
  'BALANCE',
  'REFUND',
  'PENALTY',
  'EXTRA_SERVICE',
  'COMPENSATION',
  'RESCHEDULE_FEE',
]);

export const paymentMethodSchema = z.enum([
  'VNPAY',
  'MOMO',
  'CASH',
  'BANK_TRANSFER',
  'OTA_COLLECT',
]);

export const paymentStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED']);

export const refundStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED']);

export const overbookingCaseStatusSchema = z.enum(['OPEN', 'PROPOSED', 'RESOLVED', 'ESCALATED']);

export const channelSyncStatusSchema = z.enum(['OK', 'DEGRADED']);

export const propertyStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const holdStatusSchema = z.enum(['ACTIVE', 'RELEASED', 'EXPIRED']);

export const priceSnapshotKindSchema = z.enum(['ORIGINAL', 'RESCHEDULE', 'PARTIAL_CANCEL']);

export const bookingRoomStatusSchema = z.enum(['ACTIVE', 'CANCELLED']);

export const notificationStatusSchema = z.enum(['PENDING', 'SENT', 'FAILED']);

export const loyaltyTxnTypeSchema = z.enum(['EARN', 'REDEEM', 'EXPIRE', 'ADJUST']);

export const moveTypeSchema = z.enum([
  'SAME_TYPE_SAME_PROPERTY',
  'UPGRADE_SAME_PROPERTY',
  'SAME_TYPE_CROSS_PROPERTY',
  'UPGRADE_CROSS_PROPERTY',
  'WALK_OUT',
  'SPLIT_ROOMS',
  'MERGE_SHARE',
  'MERGE_CONNECTING',
]);

export const loyaltyTierSchema = z.enum(['GUEST', 'MEMBER', 'SILVER', 'GOLD', 'PLATINUM']);

/** Vai trò KHÔNG có thứ bậc kế thừa; quyền kiểm theo thao tác × phạm vi (BR-RBAC-01, BR-RBAC-03). */
export const userRoleSchema = z.enum([
  'OWNER',
  'MANAGER',
  'FRONT_DESK',
  'RESERVATION_AGENT',
  'ACCOUNTANT',
  'HOUSEKEEPING',
  'SYSADMIN',
]);

export const notificationChannelSchema = z.enum(['EMAIL', 'SMS', 'ZALO_OA', 'PUSH']);

export const guestGenderSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED']);

/** Trạng thái tác vụ bất đồng bộ (api.md §6, mọi lệnh 202). */
export const operationStatusSchema = z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']);

/** Vòng đời phương án điều chuyển (csdl §3 `room_moves.status`); HB-120. */
export const roomMoveStatusSchema = z.enum([
  'PROPOSED',
  'APPROVED',
  'EXECUTED',
  'REJECTED',
  'CANCELLED',
]);

/** Vòng đời ghép phòng (csdl §3 `room_merges.status`); HB-120. */
export const roomMergeStatusSchema = z.enum(['PENDING_CONSENT', 'APPROVED', 'ACTIVE', 'CANCELLED']);

/** Bên ghi nhận đồng thuận ghép `MERGE_SHARE` (BR-OVER-13); D01 chỉ áp cho SHARE. */
export const roomMergeSideSchema = z.enum(['PRIMARY', 'SECONDARY']);

/** Nhóm ưu tiên giữ phòng theo BR-OVER-12: `WEAK` bị điều chuyển trước bất kể `keepScore`. */
export const relocationPriorityGroupSchema = z.enum(['WEAK', 'STRONG']);

/** Nguồn đóng ca quá tải (F6-D07): người xử lý hay job hệ thống. */
export const overbookingResolutionSourceSchema = z.enum(['USER', 'SYSTEM']);

/** Trạng thái lần quét quá tải gần nhất để UI phân biệt rỗng với chưa biết (HB-120 AC14). */
export const overbookingScanStatusSchema = z.enum(['NEVER', 'RUNNING', 'FAILED', 'SUCCEEDED']);

/** Nguồn đóng bán: thủ công hay tự động theo BR-CHAN-05 (HB-120 AC14). */
export const salesClosureSourceSchema = z.enum(['MANUAL', 'AUTOMATIC']);

/** Trạng thái giao bền từng consumer (csdl §3 `event_deliveries.status`); HB-120 AC11. */
export const outboxDeliveryStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'DEAD_LETTER',
]);

/** Sự kiện webhook simulator OTA (api.md §5.1). */
export const otaEventTypeSchema = z.enum([
  'booking.created',
  'booking.modified',
  'booking.cancelled',
]);

/** Trạng thái xử lý inbox OTA nhìn từ màn hình vận hành (HB-120 AC11). */
export const otaBookingProcessingStatusSchema = z.enum([
  'PENDING',
  'PROCESSED',
  'FAILED',
  'QUARANTINED',
]);

/** Trạng thái chi bồi thường: `UNKNOWN` tách khỏi `PENDING` khi timeout chưa rõ kết quả (F6-D06). */
export const compensationPayoutStateSchema = z.enum(['PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED']);

export type BookingStatus = z.infer<typeof bookingStatusSchema>;
export type CancelReason = z.infer<typeof cancelReasonSchema>;
export type ChannelCode = z.infer<typeof channelCodeSchema>;
export type RatePlanCode = z.infer<typeof ratePlanCodeSchema>;
export type PaymentType = z.infer<typeof paymentTypeSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type RefundStatus = z.infer<typeof refundStatusSchema>;
export type MoveType = z.infer<typeof moveTypeSchema>;
export type LoyaltyTier = z.infer<typeof loyaltyTierSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type GuestGender = z.infer<typeof guestGenderSchema>;
export type OperationStatus = z.infer<typeof operationStatusSchema>;
export type HousekeepingStatus = z.infer<typeof housekeepingStatusSchema>;
export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type ChannelSyncStatus = z.infer<typeof channelSyncStatusSchema>;
export type OverbookingCaseStatus = z.infer<typeof overbookingCaseStatusSchema>;
export type RoomMoveStatus = z.infer<typeof roomMoveStatusSchema>;
export type RoomMergeStatus = z.infer<typeof roomMergeStatusSchema>;
export type RoomMergeSide = z.infer<typeof roomMergeSideSchema>;
export type RelocationPriorityGroup = z.infer<typeof relocationPriorityGroupSchema>;
export type OverbookingResolutionSource = z.infer<typeof overbookingResolutionSourceSchema>;
export type OverbookingScanStatus = z.infer<typeof overbookingScanStatusSchema>;
export type SalesClosureSource = z.infer<typeof salesClosureSourceSchema>;
export type OutboxDeliveryStatus = z.infer<typeof outboxDeliveryStatusSchema>;
export type OtaEventType = z.infer<typeof otaEventTypeSchema>;
export type OtaBookingProcessingStatus = z.infer<typeof otaBookingProcessingStatusSchema>;
export type CompensationPayoutState = z.infer<typeof compensationPayoutStateSchema>;
