/**
 * Mã ngắn cho `webhook_inbox.last_error` và `audit_logs.reason` khi sự kiện không áp được (HB-129).
 *
 * Ràng buộc của HB-095 (`InboxOutcome`): mã `[A-Z][A-Z0-9_]+`, **không** payload/PII — nhờ vậy hàng
 * `DEAD_LETTER` có thể hiển thị cho người đối soát mà không cần quyền xem dữ liệu khách.
 */
export const OTA_CODE = {
  /** Payload đã chuẩn hoá không parse được lược đồ strict. */
  eventInvalid: 'OTA_EVENT_INVALID',
  /** `providerAccountId` của payload không trùng account của hàng inbox (AC11). */
  accountMismatch: 'OTA_ACCOUNT_MISMATCH',
  channelUnmapped: 'OTA_CHANNEL_UNMAPPED',
  propertyUnmapped: 'OTA_PROPERTY_UNMAPPED',
  roomTypeUnmapped: 'OTA_ROOM_TYPE_UNMAPPED',
  /** Tổng tiền của sự kiện lệch giá kênh đang bán (AC11). */
  amountMismatch: 'OTA_AMOUNT_MISMATCH',
  /** `paymentCollected = false`: OTA chưa xác nhận thu hộ (AC11). */
  collectionUnconfirmed: 'OTA_COLLECTION_UNCONFIRMED',
  /** `providerUpdatedAt` bằng nhau nhưng nội dung khác (AC7). */
  orderConflict: 'OTA_ORDER_CONFLICT',
  /** Create/modify cho booking đã huỷ — không hồi sinh (AC9). */
  resurrection: 'OTA_BOOKING_RESURRECTION',
  /** Sự kiện cũ hơn trạng thái đã áp (AC7) — bỏ qua, không cách ly. */
  staleEvent: 'OTA_EVENT_STALE',
  /** Booking đã huỷ: modify muộn không thắng `booking.cancelled` (AC8). */
  cancellationWins: 'OTA_CANCELLATION_WINS',
  alreadyProcessed: 'OTA_ALREADY_PROCESSED',
  alreadyTerminal: 'OTA_DEAD_LETTER',
  inProgress: 'OTA_LEASE_HELD',
  unknownEvent: 'OTA_EVENT_UNKNOWN',
  /** Không dựng được giá từ cấu hình (thiếu gói giá/loại phòng) — lỗi cấu hình, cần người xem. */
  pricingUnavailable: 'OTA_PRICING_UNAVAILABLE',
} as const;

export const OTA_QUOTA_WARNING_ACTION = 'OTA_QUOTA_OVERRUN';
export const OTA_CANCELLED_ACTION = 'BOOKING_CANCELLED';
export const OTA_DUPLICATE_FLAG_ACTION = 'BOOKING_DUPLICATE_FLAGGED';
export const OTA_QUARANTINE_ACTION = 'CHANNEL_EVENT_QUARANTINED';
