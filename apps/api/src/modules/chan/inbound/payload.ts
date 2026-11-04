/**
 * Lược đồ payload **đã chuẩn hoá** của hàng `webhook_inbox` (do `normalizeEvent` HB-128 ghi).
 *
 * Sự kiện thô không bao giờ được đọc lại từ HTTP: hàng inbox là nguồn duy nhất, nên lược đồ ở đây
 * strict (thừa khoá ⇒ không áp), và mọi trường nullable của `normalizeEvent` (`guest.phone`, `note`)
 * được chấp nhận cả `null`/vắng mặt để hàng cũ vẫn đọc được.
 */
import { businessDateSchema, channelCodeSchema, isoUtcTimestampSchema } from '@pinehill/contracts';
import { z } from 'zod';

export const OTA_EVENT_TYPES = [
  'booking.created',
  'booking.modified',
  'booking.cancelled',
] as const;

const guestSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(32).nullish(),
});

export const otaPayloadSchema = z.strictObject({
  channelCode: channelCodeSchema,
  eventType: z.enum(OTA_EVENT_TYPES),
  providerAccountId: z.string().trim().min(1).max(64),
  providerBookingCode: z.string().trim().min(1).max(128),
  providerUpdatedAt: isoUtcTimestampSchema,
  propertyCode: z.string().trim().min(1).max(32),
  roomTypeCode: z.string().trim().min(1).max(32),
  checkIn: businessDateSchema,
  checkOut: businessDateSchema,
  adults: z.number().int().min(1).max(99),
  children: z.number().int().min(0).max(99),
  roomCount: z.number().int().min(1).max(99),
  guest: guestSchema,
  amount: z.number().int().positive(),
  currency: z.literal('VND'),
  paymentCollected: z.boolean(),
  note: z.string().max(2000).nullish(),
});

export type OtaPayload = z.infer<typeof otaPayloadSchema>;
export type OtaEventType = OtaPayload['eventType'];

/** `null` = payload không đúng lược đồ (cách ly, không ném lỗi ra ngoài transaction). */
export function parsePayload(value: unknown): OtaPayload | null {
  const parsed = otaPayloadSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.checkOut <= parsed.data.checkIn) return null;
  return parsed.data;
}

/** Số đêm của kỳ `[checkIn, checkOut)`; payload đã qua lược đồ nên ngày hợp lệ. */
export function stayNights(checkIn: string, checkOut: string): readonly string[] {
  const start = Date.parse(`${checkIn}T00:00:00.000Z`);
  const end = Date.parse(`${checkOut}T00:00:00.000Z`);
  const nights: string[] = [];
  for (let at = start; at < end; at += 86_400_000)
    nights.push(new Date(at).toISOString().slice(0, 10));
  return nights;
}
