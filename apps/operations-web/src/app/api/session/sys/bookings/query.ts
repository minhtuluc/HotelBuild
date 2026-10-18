import { bookingsQuerySchema } from '@pinehill/contracts';

/**
 * `GET /bookings` (HB-201): chỉ giữ các khoá `bookingsQuerySchema` cho phép, khoá lạ bị từ chối
 * thay vì chuyển tiếp mù sang API (cùng nguyên tắc `bookingsQuery` ở web-session).
 */
export function bookingsQuery(input: Record<string, string>): Record<string, string | number> {
  const parsed = bookingsQuerySchema.parse(input);
  const result: Record<string, string | number> = { limit: parsed.limit };
  if (parsed.cursor !== undefined) result.cursor = parsed.cursor;
  if (parsed.sort !== undefined) result.sort = parsed.sort;
  if (parsed.from !== undefined) result.from = parsed.from;
  if (parsed.to !== undefined) result.to = parsed.to;
  if (parsed.q !== undefined) result.q = parsed.q;
  if (parsed.propertyId !== undefined) result.propertyId = parsed.propertyId;
  if (parsed.status !== undefined) result.status = parsed.status;
  if (parsed.channelCode !== undefined) result.channelCode = parsed.channelCode;
  return result;
}
