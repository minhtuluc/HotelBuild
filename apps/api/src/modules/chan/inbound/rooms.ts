/**
 * Các ghi atom dùng chung cho đường áp inbox OTA (AC1/AC3/AC5):
 * `booking_rooms` (mỗi đơn vị bán một dòng, **kể cả** đơn vị không gán được) +
 * `room_assignments` (chỉ đơn vị thật trống cả kỳ) + `booking_charges` ROOM + `price_snapshots`.
 *
 * Cùng hình dạng với writer HB-077 (`book/bookings/writes.ts`) nhưng **không** dùng quote: giá đã chốt
 * bởi engine cho kênh và số tiền OTA thu hộ, nên `source_key` mang thêm `seq` của snapshot để bản ghi
 * modify không đụng UNIQUE `(booking_id, source_key)` của bản ghi cũ đã void.
 */
import type { Prisma } from '@prisma/client';
import type { UnitIdentity } from '@pinehill/domain/inventory';
import type { AmountCells } from './amounts.js';

type Tx = Prisma.TransactionClient;

/** Chia `total` người cho `units` đơn vị bán; `booking_rooms.adults` yêu cầu `> 0`. */
export function spread(total: number, units: number): number[] {
  const base = Math.floor(total / units);
  const extra = total % units;
  return Array.from({ length: units }, (_, index) => base + (index < extra ? 1 : 0));
}

export interface RoomRowsInput {
  readonly bookingId: string;
  readonly roomTypeId: string;
  readonly roomCount: number;
  readonly adults: number;
  readonly children: number;
  readonly pricePerNight: number;
  /** Đơn vị bán gán được, tối đa `roomCount`; phần thiếu ở lại dạng demand chưa gán. */
  readonly units: readonly UnitIdentity[];
  readonly checkIn: string;
  readonly checkOut: string;
  readonly now: Date;
}

export async function insertRoomRows(tx: Tx, input: RoomRowsInput): Promise<readonly string[]> {
  const adults = spread(input.adults, input.roomCount);
  const children = spread(input.children, input.roomCount);
  const start = new Date(`${input.checkIn}T00:00:00.000Z`);
  const end = new Date(`${input.checkOut}T00:00:00.000Z`);
  const roomIds: string[] = [];
  for (let index = 0; index < input.roomCount; index += 1) {
    const room = await tx.booking_rooms.create({
      data: {
        booking_id: input.bookingId,
        room_type_id: input.roomTypeId,
        adults: Math.max(1, adults[index] ?? 1),
        children: children[index] ?? 0,
        price_per_night: BigInt(input.pricePerNight),
        created_at: input.now,
        updated_at: input.now,
      },
      select: { id: true },
    });
    roomIds.push(room.id);
    const unit = input.units[index];
    if (unit !== undefined) await assignUnit(tx, room.id, unit, start, end, input.now);
  }
  return roomIds;
}

async function assignUnit(
  tx: Tx,
  bookingRoomId: string,
  unit: UnitIdentity,
  start: Date,
  end: Date,
  now: Date,
): Promise<void> {
  await tx.room_assignments.create({
    data: {
      booking_room_id: bookingRoomId,
      room_id: unit.roomId,
      bed_no: unit.bedNo,
      start_date: start,
      end_date: end,
      created_at: now,
      updated_at: now,
    },
  });
}

export interface RoomSyncInput extends RoomRowsInput {
  readonly bookingId: string;
}

/**
 * Modify: giữ nguyên các `booking_rooms` đang hoạt động (demand không đứt), tạo thêm nếu kỳ mới cần
 * nhiều đơn vị hơn, đóng bớt (không xoá — dòng có charge tham chiếu) nếu cần ít hơn, rồi gán lại
 * `room_assignments` cho đơn vị thật trống (AC7 "cập nhật toàn bộ đêm/quota/demand nguyên tử").
 */
export async function syncRoomRows(tx: Tx, input: RoomSyncInput): Promise<readonly string[]> {
  const existing = await tx.booking_rooms.findMany({
    where: { booking_id: input.bookingId, status: 'ACTIVE' },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const start = new Date(`${input.checkIn}T00:00:00.000Z`);
  const end = new Date(`${input.checkOut}T00:00:00.000Z`);
  const roomIds: string[] = existing.map((row) => row.id);
  while (roomIds.length > input.roomCount) {
    const extra = roomIds.pop();
    if (extra === undefined) break;
    await tx.booking_rooms.update({
      where: { id: extra },
      data: { status: 'CANCELLED', cancelled_at: input.now, updated_at: input.now },
    });
  }
  const missing = input.roomCount - roomIds.length;
  const created =
    missing > 0 ? await insertRoomRows(tx, { ...input, roomCount: missing, units: [] }) : [];
  roomIds.push(...created);
  for (const [index, roomId] of roomIds.entries()) {
    await tx.booking_rooms.update({
      where: { id: roomId },
      data: { price_per_night: BigInt(input.pricePerNight), updated_at: input.now },
    });
    const unit = input.units[index];
    if (unit !== undefined) await assignUnit(tx, roomId, unit, start, end, input.now);
  }
  return roomIds;
}

export interface ChargesInput {
  readonly bookingId: string;
  readonly roomIds: readonly string[];
  readonly nights: readonly string[];
  readonly cells: AmountCells;
  /** Số thứ tự snapshot: giữ `source_key` duy nhất qua các lần modify. */
  readonly seq: number;
  readonly now: Date;
}

export async function insertCharges(tx: Tx, input: ChargesInput): Promise<void> {
  const rows: Prisma.booking_chargesCreateManyInput[] = [];
  for (const [index, roomId] of input.roomIds.entries()) {
    const amounts = input.cells[index] ?? [];
    for (const [nightIndex, night] of input.nights.entries()) {
      rows.push({
        booking_id: input.bookingId,
        booking_room_id: roomId,
        stay_date: new Date(`${night}T00:00:00.000Z`),
        kind: 'ROOM',
        source_key: `ROOM:${input.seq}:${roomId}:${night}`,
        amount: amounts[nightIndex] ?? 0n,
        created_at: input.now,
        updated_at: input.now,
      });
    }
  }
  if (rows.length > 0) await tx.booking_charges.createMany({ data: rows });
}

export interface SnapshotInput {
  readonly bookingId: string;
  readonly seq: number;
  readonly kind: 'ORIGINAL' | 'RESCHEDULE';
  readonly total: bigint;
  readonly payload: Prisma.InputJsonValue;
  readonly policy: Prisma.InputJsonValue;
  readonly engineVersion: string;
  readonly now: Date;
}

export async function insertSnapshot(tx: Tx, input: SnapshotInput): Promise<void> {
  await tx.price_snapshots.create({
    data: {
      booking_id: input.bookingId,
      seq: input.seq,
      kind: input.kind,
      payload_json: input.payload,
      policy_snapshot_json: input.policy,
      gross_amount: input.total,
      commission_amount: 0n,
      engine_version: input.engineVersion,
      quote_id: null,
      quote_fingerprint: null,
      channel_property_setting_id: null,
      captured_at: input.now,
      created_at: input.now,
      updated_at: input.now,
    },
  });
}
