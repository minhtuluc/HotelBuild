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
