import type { properties, room_types, rooms } from '@prisma/client';
import { numeric } from './support.js';
export const time = (value: Date) => value.toISOString().slice(11, 16);
export function propertyView(row: properties & { _count: { rooms: number } }) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    activeRoomCount: row._count.rooms,
    overbookLimitPct: Number(row.overbook_limit_pct),
    checkInTime: time(row.check_in_time),
    checkOutTime: time(row.check_out_time),
    version: numeric(row.version),
  };
}
export function publicView(row: properties) {
  return {
    id: row.id,
    name: row.name,
    checkInTime: time(row.check_in_time),
    checkOutTime: time(row.check_out_time),
  };
}
export const beds = (row: Pick<room_types, 'code' | 'capacity_adults'>) =>
  row.code === 'DOR' ? 6 : row.capacity_adults;
export function typeView(row: room_types & { rooms: { bed_count: number; status: string }[] }) {
  return {
    id: row.id,
    propertyId: row.property_id,
    code: row.code,
    capacityAdults: row.capacity_adults,
    capacityChildren: row.capacity_children,
    basePrice: numeric(row.base_price),
    minPrice: numeric(row.min_price),
    maxPrice: numeric(row.max_price),
    allowShared: row.allow_shared,
    bedCount: beds(row),
    status: row.status,
    sellingUnits: row.rooms.reduce(
      (n, r) => n + (r.status === 'ACTIVE' ? (row.allow_shared ? r.bed_count : 1) : 0),
      0,
    ),
    version: numeric(row.version),
  };
}
export function roomView(row: rooms, version: bigint) {
  return {
    id: row.id,
    propertyId: row.property_id,
    roomTypeId: row.room_type_id,
    code: row.code,
    floor: row.floor,
    status: row.status,
    connectingRoomId: row.connecting_room_id,
    version: numeric(version),
  };
}
