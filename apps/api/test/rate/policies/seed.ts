import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach } from 'vitest';
import { CANCELLATION_POLICIES, RATE_PLANS } from '../../../prisma/seed/policies.js';
import { rows, propertyId } from '../../idempotency/database.js';
export {
  db,
  rows,
  clock,
  userId,
  secondUserId,
  propertyId,
  otherPropertyId,
} from '../../idempotency/database.js';
export const policies = new Map<string, string>(),
  plans = new Map<string, string>();
let guestId = '',
  typeId = '',
  channelId = '';
export let effectsBefore = { audit: 0, outbox: 0 };
async function insert(sql: string, values: unknown[] = []) {
  return String((await rows(sql, values))[0]!.id);
}
beforeAll(async () => {
  for (const p of CANCELLATION_POLICIES)
    policies.set(
      p.code,
      await insert('INSERT INTO cancellation_policies(code,name) VALUES($1,$2) RETURNING id', [
        p.code,
        p.name,
      ]),
    );
  for (const p of RATE_PLANS)
    plans.set(
      p.code,
      await insert(
        'INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES($1,$2,$3,$4) RETURNING id',
        [p.code, p.name, p.depositPercent, policies.get(p.policyCode)],
      ),
    );
  typeId = await insert(
    "INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price) VALUES($1,'STD','Synthetic',2,100000,100000,200000) RETURNING id",
    [propertyId],
  );
  guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Synthetic HB057','+84900000057') RETURNING id",
  );
  channelId = await insert(
    "INSERT INTO channels(code,name,multiplier) VALUES('WEB','Synthetic',1) RETURNING id",
  );
});
beforeEach(async () => {
  // Owner reset only, isolated synthetic DB. Production append-only/delete guards stay enabled.
  await rows('TRUNCATE bookings CASCADE');
  await rows("UPDATE properties SET status='ACTIVE'");
  for (const p of CANCELLATION_POLICIES) {
    const id = policies.get(p.code);
    await rows(
      "UPDATE cancellation_policies SET status='ACTIVE',early_checkout_free_hours=$2,early_checkout_refund_pct=$3 WHERE id=$1",
      [id, p.earlyCheckoutFreeHours, p.earlyCheckoutRefundPct],
    );
    await rows('DELETE FROM cancellation_tiers WHERE policy_id=$1', [id]);
    for (const t of p.tiers)
      await rows(
        'INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order) VALUES($1,$2,$3,$4,$5,$6)',
        [id, t.offsetHours, t.refundPercent, t.chargeFirstNight, t.label, t.sortOrder],
      );
  }
  for (const p of RATE_PLANS)
    await rows(
      "UPDATE rate_plans SET status='ACTIVE',deposit_percent=$2,min_nights=$3,max_nights=$4,cancellation_policy_id=$5,reschedule_fee_pct=$6 WHERE id=$1",
      [
        plans.get(p.code),
        p.depositPercent,
        p.minNights,
        p.maxNights,
        policies.get(p.policyCode),
        p.rescheduleFeePct,
      ],
    );
  effectsBefore = await effects();
});
export async function effects() {
  const r = (
    await rows(
      "SELECT (SELECT count(*) FROM audit_logs WHERE action IN ('RATE_PLAN_UPDATED','CANCELLATION_POLICY_UPDATED')) AS audit,(SELECT count(*) FROM outbox_events WHERE event_type='RateChanged') AS outbox",
    )
  )[0]!;
  return { audit: Number(r.audit), outbox: Number(r.outbox) };
}
export async function version(id: string, kind = 'policy') {
  const r =
    kind === 'policy'
      ? await rows('SELECT version FROM cancellation_policies WHERE id=$1', [id])
      : await rows('SELECT version FROM rate_plans WHERE id=$1', [id]);
  return `"${String(r[0]!.version)}"`;
}
export const policyBody = () => ({
  tiers: [
    { hoursBeforeCheckIn: 168, refundPercent: 100 },
    { hoursBeforeCheckIn: 72, refundPercent: 50 },
    { hoursBeforeCheckIn: 24, refundPercent: 0 },
    { hoursBeforeCheckIn: 0, refundPercent: 0 },
  ],
  earlyCheckoutFreeHours: 72,
  earlyCheckoutRefundPct: 50,
  reason: 'Synthetic HB057 revision',
});
export async function bookedSnapshot() {
  const id = await insert(
    "INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,adults,deposit_percent,status,total_amount,paid_amount) VALUES($1,$2,$3,$4,$5,$6,'2026-11-01','2026-11-04',1,30,'CONFIRMED',300000,200000) RETURNING id",
    [
      `PH-261101-${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
      guestId,
      propertyId,
      typeId,
      plans.get('FLEX7'),
      channelId,
    ],
  );
  const room = await insert(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,1,100000) RETURNING id',
    [id, typeId],
  );
  const canonical = {
    tiers: [
      { offsetHours: 168, refundPercent: 100, chargeFirstNight: false },
      { offsetHours: 72, refundPercent: 50, chargeFirstNight: false },
      { offsetHours: 24, refundPercent: 0, chargeFirstNight: false },
      { offsetHours: -1, refundPercent: 0, chargeFirstNight: true },
    ],
  };
  const snapshot = await insert(
    "INSERT INTO price_snapshots(booking_id,seq,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version) VALUES($1,1,'{}',300000,0,$2,'hb057-test') RETURNING id",
    [id, canonical],
  );
  return { id, room, snapshot };
}
