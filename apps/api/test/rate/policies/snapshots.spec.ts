import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { expect, test } from 'vitest';
import { calculateCancellation, allocatePayment } from '@pinehill/domain/cancellation';
import { put } from './http-fixture.js';
import {
  policies,
  plans,
  rows,
  userId,
  policyBody,
  bookedSnapshot,
  effects,
  effectsBefore,
  version,
} from './seed.js';
const frozenPolicy = z.object({
  tiers: z.array(
    z.object({
      offsetHours: z.number().int(),
      refundPercent: z.number(),
      chargeFirstNight: z.boolean(),
    }),
  ),
});
const id = () => policies.get('CP-FLEX7')!;
test('retained tiers keep their identity and existing refunds remain byte-equivalent during rank shifts', async () => {
  const booking = await bookedSnapshot();
  const oldTiers = await rows('SELECT id,offset_hours FROM cancellation_tiers WHERE policy_id=$1', [
    id(),
  ]);
  const tier = String(oldTiers.find((t) => t.offset_hours === 72)!.id);
  const refund = String(
    (
      await rows(
        "INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,applied_tier_id,refund_percent,requested_amount,reason,requester_type,requester_id,requested_by) VALUES($1,$2,$3,72,$4,50,100000,'GUEST_REQUEST','USER',$5::uuid::text,$5::uuid) RETURNING id",
        [booking.id, randomUUID(), id(), tier, userId],
      )
    )[0]!.id,
  );
  const before = (await rows('SELECT * FROM refund_requests WHERE id=$1', [refund]))[0]!;
  const body = policyBody();
  body.tiers.splice(1, 0, { hoursBeforeCheckIn: 96, refundPercent: 75 });
  expect((await put(id(), body)).status).toBe(200);
  expect((await rows('SELECT * FROM refund_requests WHERE id=$1', [refund]))[0]).toEqual(before);
  const retained = await rows(
    'SELECT id,offset_hours FROM cancellation_tiers WHERE policy_id=$1 AND offset_hours<>96',
    [id()],
  );
  expect(retained.sort((a, b) => Number(b.offset_hours) - Number(a.offset_hours))).toEqual(
    oldTiers.sort((a, b) => Number(b.offset_hours) - Number(a.offset_hours)),
  );
  // Moving ranks back down also preserves all retained IDs and the refund's approval version.
  expect((await put(id(), policyBody())).status).toBe(200);
  expect((await rows('SELECT * FROM refund_requests WHERE id=$1', [refund]))[0]).toEqual(before);
});
test('editing live policy and rate plan leaves the sold snapshot and old cancellation amount unchanged', async () => {
  const booking = await bookedSnapshot();
  const before = (await rows('SELECT * FROM price_snapshots WHERE id=$1', [booking.snapshot]))[0]!;
  const input = policyBody();
  input.tiers[1]!.refundPercent = 25;
  expect((await put(id(), input)).status).toBe(200);
  expect(
    (
      await put(
        plans.get('FLEX7')!,
        {
          cancellationPolicyId: policies.get('CP-NONREF'),
          status: 'INACTIVE',
          reason: 'Synthetic revision',
        },
        { kind: 'plan' },
      )
    ).status,
  ).toBe(204);
  const after = (await rows('SELECT * FROM price_snapshots WHERE id=$1', [booking.snapshot]))[0]!;
  expect(after).toEqual(before);
  const payment = allocatePayment({
    paymentId: randomUUID(),
    amount: 200000,
    weights: [{ bookingRoomId: booking.room, weight: 300000 }],
  });
  const old = calculateCancellation({
    state: 'CONFIRMED',
    policy: frozenPolicy.parse(after.policy_snapshot_json),
    checkInDateTime: 72 * 3600000,
    now: 0,
    rooms: [{ bookingRoomId: booking.room, firstNightPrice: 100000 }],
    cancelledRoomIds: [booking.room],
    processedRoomIds: [],
    payments: [payment],
  });
  expect(old.refundAmount).toBe(100000);
  const liveTiers = await rows(
    'SELECT offset_hours,refund_percent,charge_first_night FROM cancellation_tiers WHERE policy_id=$1 ORDER BY sort_order',
    [id()],
  );
  const live = calculateCancellation({
    state: 'CONFIRMED',
    policy: {
      tiers: liveTiers.map((t) => ({
        offsetHours: Number(t.offset_hours),
        refundPercent: Number(t.refund_percent),
        chargeFirstNight: t.charge_first_night === true,
      })),
    },
    checkInDateTime: 72 * 3600000,
    now: 0,
    rooms: [{ bookingRoomId: booking.room, firstNightPrice: 100000 }],
    cancelledRoomIds: [booking.room],
    processedRoomIds: [],
    payments: [payment],
  });
  expect(live.refundAmount).toBe(50000);
});
test('a referenced removed tier preserves refund amounts and a complete original-tier audit', async () => {
  const booking = await bookedSnapshot();
  const tier = String(
    (
      await rows('SELECT id FROM cancellation_tiers WHERE policy_id=$1 AND offset_hours=72', [id()])
    )[0]!.id,
  );
  const refund = String(
    (
      await rows(
        "INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,applied_tier_id,refund_percent,requested_amount,reason,requester_type,requester_id,requested_by) VALUES($1,$2,$3,72,$4,50,100000,'GUEST_REQUEST','USER',$5::uuid::text,$5::uuid) RETURNING id",
        [booking.id, randomUUID(), id(), tier, userId],
      )
    )[0]!.id,
  );
  const r = await put(id(), {
    ...policyBody(),
    tiers: [{ hoursBeforeCheckIn: 0, refundPercent: 0, chargeFirstNight: true }],
  });
  expect(r.status).toBe(200);
  const saved = (
    await rows(
      'SELECT applied_tier_id,refund_percent,requested_amount FROM refund_requests WHERE id=$1',
      [refund],
    )
  )[0]!;
  expect(saved.applied_tier_id).toBeNull();
  expect(Number(saved.refund_percent)).toBe(50);
  expect(Number(saved.requested_amount)).toBe(100000);
  const audit = (
    await rows(
      "SELECT before_json FROM audit_logs WHERE entity_id=$1 AND action='CANCELLATION_POLICY_UPDATED' ORDER BY chain_seq DESC LIMIT 1",
      [id()],
    )
  )[0]!;
  const old = z
    .object({
      tiers: z.array(
        z.object({ id: z.uuid(), offsetHours: z.number(), refundPercent: z.number() }),
      ),
    })
    .parse(audit.before_json);
  expect(old.tiers.find((t) => t.id === tier)).toEqual({
    id: tier,
    offsetHours: 72,
    refundPercent: 50,
  });
});
test.each(['audit', 'outbox'])(
  'real %s constraint failure rolls back complete config/version/tiers and claim',
  async (target) => {
    const match = await version(id());
    const before = await rows(
      'SELECT id,offset_hours,refund_percent FROM cancellation_tiers WHERE policy_id=$1 ORDER BY sort_order',
      [id()],
    );
    const table = target === 'audit' ? 'audit_logs' : 'outbox_events',
      check =
        target === 'audit'
          ? "action <> 'CANCELLATION_POLICY_UPDATED'"
          : "event_type <> 'RateChanged'";
    await rows(`ALTER TABLE ${table} ADD CONSTRAINT hb057_failure CHECK (${check}) NOT VALID`);
    try {
      const input = policyBody();
      input.tiers[1]!.refundPercent = 25;
      const r = await put(id(), input);
      expect(r.status).toBe(500);
      expect(await version(id())).toBe(match);
      expect(
        await rows(
          'SELECT id,offset_hours,refund_percent FROM cancellation_tiers WHERE policy_id=$1 ORDER BY sort_order',
          [id()],
        ),
      ).toEqual(before);
      expect(await effects()).toEqual(effectsBefore);
      expect(Number((await rows('SELECT count(*) AS n FROM idempotency_keys'))[0]!.n)).toBe(0);
    } finally {
      await rows(`ALTER TABLE ${table} DROP CONSTRAINT hb057_failure`);
    }
    expect((await put(id(), policyBody())).status).toBe(200);
  },
);
