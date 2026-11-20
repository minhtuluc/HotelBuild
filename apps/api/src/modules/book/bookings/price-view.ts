/**
 * HB-266 — `GET /bookings/{bookingId}/nights`: đọc snapshot giá mới nhất (BR-RATE-16) và chiếu
 * phần khách được xem. Quyền đọc như `GET /bookings/{id}` (khách lạ 404, nhân viên theo phạm vi cơ sở).
 */
import type { PrismaClient } from '@prisma/client';
import { bookingPriceSnapshotSchema } from '@pinehill/contracts';
import type { BookingPriceSnapshot } from '@pinehill/contracts';
import { z } from 'zod';
import type { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import type { BookingCaller } from './principal.js';
import { requireBookingRead } from './principal.js';
import { missing } from './validation.js';

/** Phần payload snapshot cần cho khách; trường khác (hoa hồng, hệ số…) bị bỏ qua khi parse. */
const payloadSchema = z.object({
  nights: z.array(z.object({ date: z.string(), grossAmount: z.number().int() })),
  totals: z.object({
    subtotal: z.number().int(),
    discountAmount: z.number().int(),
    grossAmount: z.number().int(),
  }),
});

export async function readPriceSnapshot(
  db: PrismaClient,
  permissions: PermissionRegistry,
  caller: BookingCaller,
  bookingId: string,
): Promise<BookingPriceSnapshot> {
  const booking = await db.bookings.findUnique({
    where: { id: bookingId },
    select: { guest_id: true, property_id: true },
  });
  if (booking === null) throw missing();
  requireBookingRead(permissions, caller, {
    guestId: booking.guest_id,
    propertyId: booking.property_id,
  });
  const latest = await db.price_snapshots.findFirst({
    where: { booking_id: bookingId },
    orderBy: { seq: 'desc' },
    select: { seq: true, kind: true, captured_at: true, payload_json: true },
  });
  if (latest === null) throw missing();
  const payload = payloadSchema.parse(latest.payload_json);
  const byDate = new Map<string, { amount: number; roomCount: number }>();
  for (const night of payload.nights) {
    const current = byDate.get(night.date) ?? { amount: 0, roomCount: 0 };
    byDate.set(night.date, {
      amount: current.amount + night.grossAmount,
      roomCount: current.roomCount + 1,
    });
  }
  return bookingPriceSnapshotSchema.parse({
    bookingId,
    seq: latest.seq,
    kind: latest.kind,
    capturedAt: latest.captured_at.toISOString(),
    currency: 'VND',
    nights: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, ...value })),
    totals: payload.totals,
  });
}
