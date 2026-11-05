/**
 * HB-129 AC7–AC9 — thứ tự bản tin, huỷ OTA và tombstone (giai đoạn A, đỏ có chủ đích).
 *
 * Ba ca khoá đúng ba dòng tiêu chí:
 * - AC7: `providerUpdatedAt` tiến đơn điệu; sự kiện cũ bị bỏ; timestamp bằng nhau khác nội dung bị
 *   cách ly; modify hợp lệ cập nhật đêm/quota/snapshot **nguyên tử** và không chạy đường đổi ngày của
 *   khách (không phí RESCHEDULE_FEE, `reschedule_count = 0`).
 * - AC8: `booking.cancelled` thắng `booking.modified` bất kể thứ tự nhận; huỷ ghi
 *   `cancelReason = OTA_CANCELLATION` + `channelPolicyCode`, giải phóng demand/assignment/used đúng
 *   một lần, **không** tạo RefundRequest/REFUND/payout nội bộ.
 * - AC9: huỷ đến trước tạo lưu tombstone bền theo khoá tự nhiên; create/modify cũ, cùng timestamp
 *   hoặc đến sau không hồi sinh booking; tombstone/watermark sống qua restart và retention inbox.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import { CANCELLED_BOOKING_ACTION, SHORT_ERROR_CODE, resetApplier } from './contract.js';
import {
  accountOf,
  allotmentOf,
  applyEvent,
  applyNew,
  assignmentsOf,
  auditOf,
  bookingById,
  channelIdOf,
  clock,
  count,
  dayOf,
  http,
  inboxOf,
  instantOf,
  one,
  otaTotal,
  paymentsOf,
  propertyId,
  refundsOf,
  rows,
  sendEvent,
  snapshotsOf,
  stay,
  text,
  tombstonesOf,
  typeId,
  watermarkOf,
} from './fixture.js';

const availabilitySchema = z.object({
  data: z.array(z.object({ roomTypeCode: z.string().min(1), availableCount: z.number().int() })),
});

async function published(
  typeCode: string,
  range: { checkIn: string; checkOut: string },
): Promise<number> {
  const response = await http()
    .get('/api/v1/inventory/availability')
    .query({
      propertyId,
      ...range,
      adults: 2,
      children: 0,
      roomCount: 1,
      channelCode: 'OTA_BOOKING',
    });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const item = availabilitySchema
    .parse(response.body)
    .data.find((row) => row.roomTypeCode === typeCode);
  if (item === undefined) throw new Error(`HB129 availability is missing ${typeCode}`);
  return item.availableCount;
}

async function activeRoomTotal(bookingId: string): Promise<{ total: number; count: number }> {
  const row = one(
    await rows(
      `SELECT COALESCE(SUM(amount - voided_amount),0) AS total,
              count(*) FILTER (WHERE amount > voided_amount) AS n
         FROM booking_charges WHERE booking_id=$1 AND kind='ROOM'`,
      [bookingId],
    ),
  );
  return { total: count(row.total), count: count(row.n) };
}

test('monotonic-modify-and-equal-time-conflict', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const accountKey = accountOf('booking').accountId;
  const t0 = '2026-12-01T00:00:00.000Z';
  const t1 = '2026-12-01T01:00:00.000Z';
  for (const night of ['2026-12-10', '2026-12-11', '2026-12-12']) {
    await rows(
      'INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,used) VALUES($1,$2,$3,2,0)',
      [channel, typeId, night],
    );
  }
  const shorterTotal = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const { bookingId } = await applyNew('modify-create', {
    bookingCode: 'HB129-MOD-1',
    amount: shorterTotal,
    updatedAt: t0,
  });
  expect([await usedOn(channel, '2026-12-10'), await usedOn(channel, '2026-12-11')]).toEqual([
    1, 1,
  ]);

  const longer = { checkIn: stay.checkIn, checkOut: '2026-12-13' };
  const longerTotal = await otaTotal({ roomTypeId: typeId, ...longer });
  const modified = await applyNew('modify-update', {
    bookingCode: 'HB129-MOD-1',
    eventType: 'booking.modified',
    checkOut: longer.checkOut,
    amount: longerTotal,
    updatedAt: t1,
  });
  expect(modified.bookingId).toBe(bookingId);
  const booking = one(await bookingById(bookingId));
  expect(dayOf(booking.check_out)).toBe(longer.checkOut);
  expect(count(booking.total_amount)).toBe(longerTotal);
  expect(count(booking.reschedule_count)).toBe(0);
  expect(booking.hold_expires_at).toBeNull();
  const charged = await activeRoomTotal(bookingId);
  expect(charged).toEqual({ total: longerTotal, count: 3 });
  expect(await usedOn(channel, '2026-12-12')).toBe(1);
  const feeCharges = one(
    await rows(
      `SELECT count(*) AS n FROM booking_charges
        WHERE booking_id=$1 AND kind IN ('RESCHEDULE_FEE','PENALTY') AND amount > voided_amount`,
      [bookingId],
    ),
  );
  expect(count(feeCharges.n)).toBe(0);
  const snapshots = await snapshotsOf(bookingId);
  expect(snapshots).toHaveLength(2);
  expect(count(snapshots[1]?.gross_amount)).toBe(longerTotal);
  const watermarked = one(await watermarkOf(channel, accountKey));
  expect(instantOf(watermarked.watermark_at)).toBe(Date.parse(t1));

  const stale = await sendEvent('modify-stale', {
    bookingCode: 'HB129-MOD-1',
    eventType: 'booking.modified',
    checkOut: '2026-12-14',
    amount: longerTotal,
    updatedAt: '2026-11-30T23:00:00.000Z',
  });
  expect((await applyEvent(stale.id)).status).not.toBe('APPLIED');
  expect(dayOf(one(await bookingById(bookingId)).check_out)).toBe(longer.checkOut);
  expect(await snapshotsOf(bookingId)).toHaveLength(2);
  expect(instantOf(one(await watermarkOf(channel, accountKey)).watermark_at)).toBe(Date.parse(t1));

  const conflict = await sendEvent('modify-conflict', {
    bookingCode: 'HB129-MOD-1',
    eventType: 'booking.modified',
    checkOut: '2026-12-15',
    amount: longerTotal,
    updatedAt: t1,
  });
  const conflicted = await applyEvent(conflict.id);
  expect(conflicted.status).toBe('QUARANTINED');
  const quarantined = one(await inboxOf(conflict.id));
  expect(text(quarantined.status)).toBe('DEAD_LETTER');
  expect(text(quarantined.last_error)).toMatch(SHORT_ERROR_CODE);
  const trail = await rows('SELECT actor_role FROM audit_logs WHERE entity_id=$1::uuid', [
    quarantined.id,
  ]);
  expect(trail.length).toBeGreaterThanOrEqual(1);
  expect(trail.every((row) => text(row.actor_role) === 'SYSTEM')).toBe(true);
  expect(dayOf(one(await bookingById(bookingId)).check_out)).toBe(longer.checkOut);
  expect(await snapshotsOf(bookingId)).toHaveLength(2);
  expect(instantOf(one(await watermarkOf(channel, accountKey)).watermark_at)).toBe(Date.parse(t1));
});

async function usedOn(channelId: string, date: string): Promise<number> {
  return count(one(await allotmentOf(channelId, typeId, date)).used);
}

test('ota-cancel-without-internal-refund', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const accountKey = accountOf('booking').accountId;
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  for (const night of ['2026-12-10', '2026-12-11']) {
    await rows(
      'INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,used) VALUES($1,$2,$3,2,0)',
      [channel, typeId, night],
    );
  }
  const before = await published('STD', stay);

  const created = await applyNew('cancel-a-create', {
    bookingCode: 'HB129-CANCEL-A',
    amount: total,
    updatedAt: '2026-12-01T00:00:00.000Z',
  });
  await applyNew('cancel-a-modify', {
    bookingCode: 'HB129-CANCEL-A',
    eventType: 'booking.modified',
    amount: total,
    updatedAt: '2026-12-01T01:00:00.000Z',
  });
  expect(await published('STD', stay)).toBe(before - 1);
  const cancelled = await applyNew('cancel-a-cancel', {
    bookingCode: 'HB129-CANCEL-A',
    eventType: 'booking.cancelled',
    amount: total,
    updatedAt: '2026-12-01T02:00:00.000Z',
  });
  expect(cancelled.bookingId).toBe(created.bookingId);
  const row = one(await bookingById(created.bookingId));
  expect(text(row.status)).toBe('CANCELLED');
  expect(instantOf(row.cancelled_at)).toBe(clock.now().getTime());
  expect(text(row.cancel_reason)).toBe('OTA_CANCELLATION');
  expect(text(row.channel_policy_code).length).toBeGreaterThan(0);
  expect(count(row.penalty_amount)).toBe(0);
  expect(count(row.refunded_amount)).toBe(0);
  const released = await assignmentsOf(created.bookingId);
  expect(released).toHaveLength(1);
  expect(released[0]?.released_at).not.toBeNull();
  expect(await published('STD', stay)).toBe(before);
  expect(await usedOn(channel, '2026-12-10')).toBe(0);
  expect(await usedOn(channel, '2026-12-11')).toBe(0);

  const audit = (await auditOf(created.bookingId)).filter(
    (entry) => text(entry.action) === CANCELLED_BOOKING_ACTION,
  );
  expect(audit).toHaveLength(1);
  const after = z
    .object({ after_json: z.object({ cancelReason: z.string(), channelPolicyCode: z.string() }) })
    .parse(audit[0]);
  expect(after.after_json.cancelReason).toBe('OTA_CANCELLATION');
  expect(after.after_json.channelPolicyCode.length).toBeGreaterThan(0);
  expect(await refundsOf(created.bookingId)).toHaveLength(0);
  expect(
    (await paymentsOf(created.bookingId)).filter((payment) => text(payment.type) === 'REFUND'),
  ).toHaveLength(0);
  expect(
    count(
      one(
        await rows(
          "SELECT count(*) AS n FROM booking_charges WHERE booking_id=$1 AND kind IN ('PENALTY','RESCHEDULE_FEE') AND amount > voided_amount",
          [created.bookingId],
        ),
      ).n,
    ),
  ).toBe(0);

  // Phát lại huỷ: demand/used không bị giải phóng lần hai (used âm sẽ vi phạm CHECK).
  expect((await applyEvent(cancelled.id)).status).not.toBe('APPLIED');
  expect(await usedOn(channel, '2026-12-10')).toBe(0);

  // Thứ tự ngược: modified đã thắng trước đó nhưng cancel có timestamp cũ hơn vẫn thắng.
  const second = await applyNew('cancel-b-create', {
    bookingCode: 'HB129-CANCEL-B',
    amount: total,
    updatedAt: '2026-12-01T00:00:00.000Z',
  });
  await applyNew('cancel-b-modify', {
    bookingCode: 'HB129-CANCEL-B',
    eventType: 'booking.modified',
    amount: total,
    updatedAt: '2026-12-01T03:00:00.000Z',
  });
  await applyNew('cancel-b-cancel', {
    bookingCode: 'HB129-CANCEL-B',
    eventType: 'booking.cancelled',
    amount: total,
    updatedAt: '2026-12-01T02:00:00.000Z',
  });
  const secondRow = one(await bookingById(second.bookingId));
  expect(text(secondRow.status)).toBe('CANCELLED');
  expect(instantOf(secondRow.cancelled_at)).toBe(clock.now().getTime());
  const secondSnapshots = await snapshotsOf(second.bookingId);
  expect(secondSnapshots).toHaveLength(2);
  const late = await sendEvent('cancel-b-late-modify', {
    bookingCode: 'HB129-CANCEL-B',
    eventType: 'booking.modified',
    amount: total,
    updatedAt: '2026-12-01T04:00:00.000Z',
  });
  expect((await applyEvent(late.id)).status).not.toBe('APPLIED');
  expect(text(one(await bookingById(second.bookingId)).status)).toBe('CANCELLED');
  expect(await snapshotsOf(second.bookingId)).toHaveLength(2);
  expect(await refundsOf(second.bookingId)).toHaveLength(0);
  expect(await paymentsOf(second.bookingId)).toHaveLength(1);
  expect(instantOf(one(await watermarkOf(channel, accountKey)).watermark_at)).toBe(
    Date.parse('2026-12-01T03:00:00.000Z'),
  );
});

test('cancel-before-create-tombstone', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const accountKey = accountOf('booking').accountId;
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const cancelledAt = '2026-12-01T00:00:00.000Z';
  const withoutBooking = async (suffix: string, updatedAt: string): Promise<string> => {
    const { id } = await sendEvent(suffix, {
      bookingCode: 'HB129-TOMB-1',
      eventType: 'booking.cancelled',
      amount: total,
      updatedAt,
    });
    return id;
  };
  const cancelId = await withoutBooking('tomb-cancel', cancelledAt);
  const applied = await applyEvent(cancelId);
  expect(applied.status).toBe('APPLIED');
  expect(applied.bookingId).toBeNull();
  const tombstone = one(await tombstonesOf('HB129-TOMB-1'));
  expect(text(tombstone.channel_id)).toBe(channel);
  expect(text(tombstone.account_key)).toBe(accountKey);
  expect(text(tombstone.cancel_reason)).toBe('OTA_CANCELLATION');
  expect(instantOf(tombstone.provider_updated_at)).toBe(Date.parse(cancelledAt));
  expect(instantOf(tombstone.cancelled_at)).toBe(clock.now().getTime());
  expect(tombstone.booking_id).toBeNull();

  const older = await sendEvent('tomb-create-old', {
    bookingCode: 'HB129-TOMB-1',
    amount: total,
    updatedAt: '2026-11-30T00:00:00.000Z',
  });
  expect((await applyEvent(older.id)).status).toBe('QUARANTINED');
  expect(await rows('SELECT id FROM bookings WHERE property_id=$1', [propertyId])).toHaveLength(0);
  expect(await tombstonesOf('HB129-TOMB-1')).toHaveLength(1);

  await rows('DELETE FROM webhook_inbox');
  const equal = await sendEvent('tomb-create-equal', {
    bookingCode: 'HB129-TOMB-1',
    amount: total,
    updatedAt: cancelledAt,
  });
  expect((await applyEvent(equal.id)).status).toBe('QUARANTINED');
  expect(await rows('SELECT id FROM bookings WHERE property_id=$1', [propertyId])).toHaveLength(0);

  const newer = await sendEvent('tomb-create-new', {
    bookingCode: 'HB129-TOMB-1',
    amount: total,
    updatedAt: '2026-12-02T00:00:00.000Z',
  });
  expect((await applyEvent(newer.id)).status).toBe('QUARANTINED');
  expect(await rows('SELECT id FROM bookings WHERE property_id=$1', [propertyId])).toHaveLength(0);
  expect(
    instantOf(one(await watermarkOf(channel, accountKey)).watermark_at),
  ).toBeGreaterThanOrEqual(Date.parse(cancelledAt));

  resetApplier();
  const afterRestart = await sendEvent('tomb-create-restart', {
    bookingCode: 'HB129-TOMB-1',
    amount: total,
    updatedAt: '2026-12-02T01:00:00.000Z',
  });
  expect((await applyEvent(afterRestart.id)).status).toBe('QUARANTINED');
  expect(await rows('SELECT id FROM bookings WHERE property_id=$1', [propertyId])).toHaveLength(0);
  const persisted = one(await tombstonesOf('HB129-TOMB-1'));
  expect(text(persisted.cancel_reason)).toBe('OTA_CANCELLATION');
  expect(instantOf(persisted.cancelled_at)).toBe(clock.now().getTime());
});
