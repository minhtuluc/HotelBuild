import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach } from 'vitest';
import { rows, propertyId, otherPropertyId, userId } from '../idempotency/database.js';
export {
  db,
  rows,
  clock,
  ids,
  propertyId,
  otherPropertyId,
  userId,
  secondUserId,
} from '../idempotency/database.js';
export let typeId = '',
  dormTypeId = '',
  otherTypeId = '',
  roomId = '',
  room2Id = '',
  dormId = '',
  otherRoomId = '';
let rateId = '',
  guestId = '';
const channels = new Map<string, string>();
export const stay = { checkIn: '2026-11-01', checkOut: '2026-11-04' };
async function insert(sql: string, values: unknown[] = []) {
  return String((await rows(sql, values))[0]!.id);
}
beforeAll(async () => {
  const policy = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('H034','Synthetic') RETURNING id",
  );
  rateId = await insert(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Synthetic',30,$1) RETURNING id",
    [policy],
  );
  guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Synthetic','+84900000034') RETURNING id",
  );
  for (const code of ['WEB', 'PHONE', 'WALKIN', 'OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB', 'AGENCY'])
    channels.set(
      code,
      await insert('INSERT INTO channels(code,name,multiplier) VALUES($1,$1,1) RETURNING id', [
        code,
      ]),
    );
  for (const [prop, code, shared] of [
    [propertyId, 'STD', false],
    [propertyId, 'DOR', true],
    [otherPropertyId, 'STD', false],
  ] as const) {
    const id = await insert(
      'INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price,allow_shared) VALUES($1,$2,$2,2,100000,100000,200000,$3) RETURNING id',
      [prop, code, shared],
    );
    if (prop !== propertyId) otherTypeId = id;
    else if (shared) dormTypeId = id;
    else typeId = id;
  }
  for (const [prop, type, code, beds] of [
    [propertyId, typeId, 'R1', 1],
    [propertyId, typeId, 'R2', 1],
    [propertyId, dormTypeId, 'D1', 6],
    [otherPropertyId, otherTypeId, 'R1', 1],
  ] as const) {
    const id = await insert(
      'INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,$3,$3,$4) RETURNING id',
      [prop, type, code, beds],
    );
    if (prop !== propertyId) otherRoomId = id;
    else if (type === dormTypeId) dormId = id;
    else if (code === 'R1') roomId = id;
    else room2Id = id;
  }
}, 60000);
beforeEach(async () => {
  await rows('DELETE FROM room_blocks');
  await rows('DELETE FROM room_assignments');
  await rows('DELETE FROM overbooking_cases');
  // Owner-only reset of the isolated synthetic test DB; runtime deletion guards stay enabled.
  await rows('TRUNCATE bookings CASCADE');
  await rows('DELETE FROM channel_allotments');
  await rows("UPDATE rooms SET status='ACTIVE'");
});
export async function booking(
  options: {
    status?: string;
    channel?: string;
    property?: string;
    type?: string;
    deadline?: Date;
    start?: string;
    end?: string;
    oversold?: boolean;
  } = {},
) {
  const values = {
    status: 'CONFIRMED',
    channel: 'WEB',
    property: propertyId,
    type: typeId,
    deadline: null,
    start: stay.checkIn,
    end: stay.checkOut,
    oversold: false,
    ...options,
  };
  const b = await insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status,hold_expires_at,oversold,cancelled_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,30,$9,$10,$11,CASE WHEN $9='CANCELLED' THEN clock_timestamp() END) RETURNING id`,
    [
      `PH-261101-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
      guestId,
      values.property,
      values.type,
      rateId,
      channels.get(values.channel),
      values.start,
      values.end,
      values.status,
      values.deadline,
      values.oversold,
    ],
  );
  const br = await insert(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,100000) RETURNING id',
    [b, values.type],
  );
  return { id: b, room: br };
}
export async function assign(
  br: string,
  room = roomId,
  start = stay.checkIn,
  end = stay.checkOut,
  bed = 0,
) {
  return insert(
    'INSERT INTO room_assignments(booking_room_id,room_id,bed_no,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [br, room, bed, start, end],
  );
}
export async function block(room = roomId, start = stay.checkIn, end = stay.checkOut) {
  return insert(
    "INSERT INTO room_blocks(room_id,start_date,end_date,reason,created_by) VALUES($1,$2,$3,'MAINTENANCE',$4) RETURNING id",
    [room, start, end, userId],
  );
}
export async function allotment(channel: string, amount: number, closed = false, type = typeId) {
  await rows(
    "INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,is_closed,closed_reason,closed_at) VALUES($1,$2,$3,$4,$5,CASE WHEN $5 THEN 'Synthetic close' END,CASE WHEN $5 THEN clock_timestamp() END)",
    [channels.get(channel), type, stay.checkIn, amount, closed],
  );
}
