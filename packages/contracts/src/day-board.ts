/**
 * HB-242 (TD-09) — `GET /operations/day-board`: bảng điều khiển ngày SCR-23 (UC-INV-01, UC-FO-01,
 * UC-OVER-01). Một ảnh chụp cho **một cơ sở × một ngày nghiệp vụ VN**: khách đến, khách đi, khách ở qua
 * đêm, ca quá tải đang mở và kênh đồng bộ `DEGRADED`. Mọi số do máy chủ đếm; giao diện không tự dựng lại
 * từ danh sách booking.
 */
import { z } from 'zod';
import { businessDateSchema, isoUtcTimestampSchema } from './common.js';
import { bookingStatusSchema, channelCodeSchema } from './enums.js';

export const dayBoardQuerySchema = z.strictObject({
  propertyId: z.string().min(1),
  /** Ngày nghiệp vụ VN; vắng ⇒ hôm nay theo đồng hồ CSDL (giờ VN). */
  date: businessDateSchema.optional(),
});

/** Một booking trên bảng ngày. Chỉ dữ liệu vận hành cần để lễ tân hành động; không có SĐT/giấy tờ. */
export const dayBoardBookingSchema = z.object({
  bookingId: z.string().min(1),
  code: z.string().min(1),
  guestName: z.string().min(1),
  roomTypeId: z.string().min(1),
  roomCount: z.number().int().min(1),
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  status: bookingStatusSchema,
  channelCode: channelCodeSchema,
  /** `bookings.balance_due` (sổ cái, HB-237): còn phải thu, VND nguyên. */
  balanceDue: z.number().int().min(0),
});

/** Một nhóm booking: `total` là số thật; `items` tối đa `DAY_BOARD_ITEM_LIMIT`, `truncated` báo bị cắt. */
export const dayBoardGroupSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(dayBoardBookingSchema),
  truncated: z.boolean(),
});

export const DAY_BOARD_ITEM_LIMIT = 200;

export const dayBoardSchema = z.object({
  propertyId: z.string().min(1),
  date: businessDateSchema,
  /** Thời điểm CSDL chụp số liệu (UTC); màn hình hiện "Cập nhật lúc … (giờ VN)". */
  capturedAt: isoUtcTimestampSchema,
  /** `check_in = date`, booking `CONFIRMED` (chưa nhận) hoặc `CHECKED_IN` (đã nhận trong ngày). */
  arrivals: dayBoardGroupSchema,
  /** `check_out = date`, booking `CHECKED_IN` (chưa trả) hoặc `CHECKED_OUT` (đã trả trong ngày). */
  departures: dayBoardGroupSchema,
  /** Ở qua đêm `date`: `check_in ≤ date < check_out`, booking `CONFIRMED` hoặc `CHECKED_IN`. */
  inHouse: dayBoardGroupSchema,
  /** Ca quá tải chưa giải quyết (`OPEN`/`PROPOSED`/`ESCALATED`) của cơ sở cho đêm `date` trở đi. */
  overbooking: z.object({
    openFromDate: z.number().int().min(0),
    onDate: z.number().int().min(0),
  }),
  /** Kênh `ACTIVE` đang `DEGRADED` (kênh là cấu hình toàn chuỗi). */
  degradedChannels: z.array(
    z.object({
      channelId: z.string().min(1),
      code: channelCodeSchema,
      name: z.string().min(1),
      consecutiveFailures: z.number().int().min(0),
      lastSyncAt: isoUtcTimestampSchema.nullable(),
    }),
  ),
});

export type DayBoardQuery = z.infer<typeof dayBoardQuerySchema>;
export type DayBoardBooking = z.infer<typeof dayBoardBookingSchema>;
export type DayBoard = z.infer<typeof dayBoardSchema>;
