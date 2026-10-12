import { randomUUID } from 'node:crypto';
import { rows, booking, db, userId, clock } from '../room-blocks/inventory-seed.js';
export { rows, booking, db, userId, clock };
export const actor = () => ({
  id: userId,
  role: 'FRONT_DESK',
  ip: null,
  correlationId: 'synthetic-hb093',
});
export async function receipt(
  bookingId: string,
  amount: bigint,
  type = 'DEPOSIT',
  status = 'SUCCEEDED',
) {
  return String(
    (
      await rows(
        `INSERT INTO payments(booking_id,type,method,amount,status,idempotency_key,paid_at,created_by)
    VALUES($1,$2,'BANK_TRANSFER',$3,$4,$5,CASE WHEN $4='SUCCEEDED' THEN clock_timestamp() END,$6) RETURNING id`,
        [bookingId, type, amount.toString(), status, randomUUID(), userId],
      )
    )[0]!.id,
  );
}
export async function charge(bookingId: string, roomId: string, amount: bigint, kind = 'ROOM') {
  const id = String(
    (
      await rows(
        `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
    VALUES($1,$2,'2026-11-01',$3,$4,$5) RETURNING id`,
        [bookingId, roomId, kind, randomUUID(), amount.toString()],
      )
    )[0]!.id,
  );
  if (kind === 'ROOM' || kind === 'PENALTY')
    await rows(
      `UPDATE bookings SET ${kind === 'ROOM' ? 'total_amount' : 'penalty_amount'} = (SELECT coalesce(sum(amount-voided_amount),0) FROM booking_charges WHERE booking_id=$1 AND kind=$2) WHERE id=$1`,
      [bookingId, kind],
    );
  return id;
}
export async function request(bookingId: string, gross: bigint, fee = 0n) {
  return String(
    (
      await rows(
        `INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,refund_percent,
    requested_amount,refund_fee,reason,requester_type,requester_id)
    VALUES($1,$2,(SELECT cancellation_policy_id FROM rate_plans WHERE code='FLEX7'),200,100,$3,$4,'SYSTEM','SYSTEM','synthetic') RETURNING id`,
        [bookingId, randomUUID(), gross.toString(), fee.toString()],
      )
    )[0]!.id,
  );
}
