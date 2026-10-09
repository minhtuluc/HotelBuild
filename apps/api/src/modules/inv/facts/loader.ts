import { z } from 'zod';
import { channelCodeSchema, roomStatusSchema } from '@pinehill/contracts';
import type { Prisma } from '@prisma/client';
import type {
  AvailabilityInput,
  ChannelCode,
  Demand,
  NightRange,
  Location,
} from '@pinehill/domain/inventory';
export interface InventoryQuery extends NightRange, Location {
  readonly channelCode: ChannelCode;
}
export const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);
const demandStatus = z.enum([
  'CONFIRMED',
  'CHECKED_IN',
  'HELD',
  'PENDING_PAYMENT',
  'CANCELLED',
  'EXPIRED',
  'CHECKED_OUT',
]);
const inactive = new Set(['DRAFT', 'NO_SHOW', 'EXPIRED']);

/** Primary DB only; callers that decide writes first acquire the ADR-014 resource locks. */
export async function loadInventoryFacts(
  tx: Prisma.TransactionClient,
  query: InventoryQuery,
): Promise<AvailabilityInput> {
  const start = new Date(`${query.checkIn}T00:00:00Z`),
    end = new Date(`${query.checkOut}T00:00:00Z`);
  const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
  const rooms = await tx.rooms.findMany({
    where: { property_id: query.propertyId, room_type_id: query.roomTypeId },
    include: { room_types: true, properties: true },
    orderBy: { id: 'asc' },
  });
  const range = { start_date: { lt: end }, end_date: { gt: start } };
  const blocks = await tx.room_blocks.findMany({
    where: { room_id: { in: rooms.map((r) => r.id) }, ...range },
  });
  // Include commitments without assignments AND destination allocations after cross-property/type moves.
  // Load inactive facts too: unreleased assignments of cancelled/expired bookings are not demand.
  const bookingRooms = await tx.booking_rooms.findMany({
    where: {
      OR: [
        {
          room_type_id: query.roomTypeId,
          bookings: {
            property_id: query.propertyId,
            check_in: { lt: end },
            check_out: { gt: start },
          },
        },
        {
          room_assignments: {
            some: {
              ...range,
              rooms: { property_id: query.propertyId, room_type_id: query.roomTypeId },
            },
          },
        },
      ],
    },
    include: {
      bookings: { include: { channels: true } },
      room_assignments: { include: { rooms: true } },
    },
  });
  const demand: Demand[] = [];
  for (const br of bookingRooms) {
    const booking = br.bookings;
    const from = [query.checkIn, dateOnly(booking.check_in)].sort().at(-1)!;
    const to = [query.checkOut, dateOnly(booking.check_out)].sort()[0]!;
    if (from >= to) continue;
    const active = br.room_assignments.filter(
      (a) => a.released_at === null && dateOnly(a.start_date) < to && dateOnly(a.end_date) > from,
    );
    const boundaries = [
      ...new Set([
        from,
        to,
        ...active
          .flatMap((a) => [dateOnly(a.start_date), dateOnly(a.end_date)])
          .filter((d) => d > from && d < to),
      ]),
    ].sort();
    for (let i = 0; i < boundaries.length - 1; i++) {
      const checkIn = boundaries[i]!,
        checkOut = boundaries[i + 1]!;
      const allocated = active.filter(
        (a) => dateOnly(a.start_date) <= checkIn && dateOnly(a.end_date) > checkIn,
      );
      const locations = new Set(
        allocated.map((a) => `${a.rooms.property_id}/${a.rooms.room_type_id}`),
      );
      if (locations.size > 1) throw new Error('Inconsistent inventory allocation locations');
      const room = allocated[0]?.rooms;
      const status: Demand['status'] =
        br.status === 'CANCELLED'
          ? 'CANCELLED'
          : inactive.has(booking.status)
            ? 'EXPIRED'
            : demandStatus.parse(booking.status);
      demand.push({
        bookingRoomId: br.id,
        propertyId: booking.property_id,
        roomTypeId: br.room_type_id,
        channelCode: channelCodeSchema.parse(booking.channels.code),
        status,
        holdExpiresAt: booking.hold_expires_at,
        checkIn,
        checkOut,
        ...(room
          ? { allocatedLocation: { propertyId: room.property_id, roomTypeId: room.room_type_id } }
          : {}),
      });
    }
  }
  const allotments = await tx.channel_allotments.findMany({
    where: { room_type_id: query.roomTypeId, date: { gte: start, lt: end } },
    include: { channels: true },
  });
  return {
    ...query,
    now,
    units: rooms.flatMap((room) =>
      Array.from({ length: room.room_types.allow_shared ? room.bed_count : 1 }, (_, i) => ({
        roomId: room.id,
        bedNo: room.room_types.allow_shared ? i + 1 : 0,
        propertyId: room.property_id,
        roomTypeId: room.room_type_id,
        status:
          room.room_types.status === 'ACTIVE' && room.properties.status === 'ACTIVE'
            ? roomStatusSchema.parse(room.status)
            : 'INACTIVE',
      })),
    ),
    blocks: blocks.map((b) => ({
      roomId: b.room_id,
      checkIn: dateOnly(b.start_date),
      checkOut: dateOnly(b.end_date),
    })),
    assignments: bookingRooms.flatMap((br) =>
      br.room_assignments
        .filter((a) => rooms.some((r) => r.id === a.room_id))
        .map((a) => ({
          bookingRoomId: br.id,
          roomId: a.room_id,
          bedNo: a.bed_no,
          checkIn: dateOnly(a.start_date),
          checkOut: dateOnly(a.end_date),
          releasedAt: a.released_at,
        })),
    ),
    demand,
    allotments: allotments.map((a) => ({
      propertyId: query.propertyId,
      roomTypeId: a.room_type_id,
      channelCode: channelCodeSchema.parse(a.channels.code),
      date: dateOnly(a.date),
      allotment: a.is_closed ? 0 : a.allotment,
    })),
  };
}
