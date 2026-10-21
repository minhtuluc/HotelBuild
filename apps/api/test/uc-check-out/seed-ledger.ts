/** Sổ nghĩa vụ ROOM + Payment SUCCEEDED đã phân bổ cho fixture HB-145 (BR-PAY-02). */
import { randomUUID } from 'node:crypto';
import { rows, userId } from '../idempotency/database.js';

const ROOM_CHARGE = `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
  VALUES($1,$2,$3,'ROOM',$4,$5) RETURNING id`;
const PAYMENT = `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
  VALUES($1,'DEPOSIT','BANK_TRANSFER',$2,'SUCCEEDED',$3,clock_timestamp(),$4) RETURNING id`;
const ALLOCATE = 'INSERT INTO payment_allocations(payment_id,charge_id,amount) VALUES($1,$2,$3)';

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

export async function insertLedger(
  id: string,
  bookingRoomId: string,
  checkIn: string,
  nightly: number,
  nights: number,
  paid: number,
  day: (date: string, offset: number) => string,
): Promise<void> {
  const charges: string[] = [];
  for (let night = 0; night < nights; night += 1) {
    const stayDate = day(checkIn, night);
    charges.push(
      await insert(ROOM_CHARGE, [
        id,
        bookingRoomId,
        stayDate,
        `room:${bookingRoomId}:${stayDate}`,
        nightly,
      ]),
    );
  }
  if (paid <= 0) return;
  const payment = await insert(PAYMENT, [id, paid, randomUUID(), userId]);
  let left = paid;
  for (const charge of charges) {
    if (left <= 0) break;
    const amount = Math.min(left, nightly);
    await rows(ALLOCATE, [payment, charge, amount]);
    left -= amount;
  }
}
