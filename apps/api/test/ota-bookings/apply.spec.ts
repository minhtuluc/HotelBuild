/**
 * HB-129 AC1–AC5, AC11 — áp inbox OTA thành booking/tồn/tiền/snapshot (giai đoạn A, đỏ có chủ đích).
 *
 * Mỗi `test` ứng đúng một dòng tiêu chí của ticket. Test đỏ vì use case
 * `apps/api/src/modules/chan/inbound/index.ts` chưa tồn tại (xem `./contract.ts`), không vì fixture:
 * event đi qua webhook thật của HB-128, giá lấy từ engine giá thật với danh tính `SYSTEM`, rồi áp
 * bằng seam động.
 */
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  FAM_CODE,
  accountOf,
  applyEvent,
  applyNew,
  allotmentOf,
  assignmentsOf,
  auditOf,
  bookingById,
  casesOf,
  channelIdOf,
  clock,
  count,
  countBookings,
  dayOf,
  draft,
  expectOtaCollect,
  expectQuarantinedInbox,
  famRoomTypeId,
  http,
  insertInbox,
  one,
  otaTotal,
  paymentsOf,
  propertyId,
  rows,
  sendEvent,
  snapshotsOf,
  stay,
  text,
  typeId,
  userId,
  type EventDraft,
} from './fixture.js';

const availabilitySchema = z.object({
  data: z.array(
    z.object({
      roomTypeCode: z.string().min(1),
      availableCount: z.number().int(),
      soldOut: z.boolean(),
    }),
  ),
});

test('confirmed-ota-collect', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const { bookingId } = await applyNew('collect', {
    bookingCode: 'HB129-COLLECT-1',
    amount: total,
  });
  expect(text(one(await bookingById(bookingId)).external_ref)).toContain('HB129-COLLECT-1');
  await expectOtaCollect(bookingId, channel, total);
  const history = await rows('SELECT to_status FROM booking_status_history WHERE booking_id=$1', [
    bookingId,
  ]);
  expect(history.map((row) => text(row.to_status))).toContain('CONFIRMED');
});

test('confirmed-over-quota-always-accepted', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const fam = famRoomTypeId();
  const loft = { checkIn: '2026-12-15', checkOut: '2026-12-16' };
  await rows(
    `INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,used,is_closed,closed_reason,closed_at)
     VALUES($1,$2,$3,2,0,true,'HB129 closed by operator',clock_timestamp())`,
    [channel, fam, loft.checkIn],
  );
  const total = await otaTotal({ roomTypeId: fam, ...loft });
  const bookingIds: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const { bookingId } = await applyNew(`quota-${index}`, {
      bookingCode: `HB129-QUOTA-${index}`,
      roomTypeCode: FAM_CODE,
      checkIn: loft.checkIn,
      checkOut: loft.checkOut,
      amount: total,
    });
    bookingIds.push(bookingId);
  }
  for (const bookingId of bookingIds) {
    const booking = one(await bookingById(bookingId));
    expect(text(booking.status)).toBe('CONFIRMED');
    expect(booking.oversold).toBe(false);
  }

  const allotment = one(await allotmentOf(channel, fam, loft.checkIn));
  expect(count(allotment.allotment)).toBe(2);
  expect(count(allotment.used)).toBe(5);
  expect(allotment.is_closed).toBe(true);

  const availability = await http()
    .get('/api/v1/inventory/availability')
    .query({
      propertyId,
      ...loft,
      adults: 2,
      children: 0,
      roomCount: 1,
      channelCode: 'OTA_BOOKING',
    });
  expect(availability.status, JSON.stringify(availability.body)).toBe(200);
  const listed = availabilitySchema
    .parse(availability.body)
    .data.find((item) => item.roomTypeCode === FAM_CODE);
  if (listed === undefined) throw new Error('HB129 availability is missing FAM');
  expect(listed.availableCount).toBe(0);
  expect(listed.soldOut).toBe(true);

  const overrun = (await auditOf(text(allotment.id))).filter(
    (row) =>
      text(row.action) === 'OTA_QUOTA_OVERRUN' && text(row.entity_type) === 'channel_allotment',
  );
  expect(overrun.length).toBeGreaterThanOrEqual(1);
  expect(overrun.every((row) => text(row.actor_role) === 'SYSTEM')).toBe(true);
});

test('nightly-shortage-and-grouped-cases', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const fam = famRoomTypeId();
  const blocked = { checkIn: '2026-12-20', checkOut: '2026-12-22' };
  await rows(
    `INSERT INTO room_blocks(room_id,start_date,end_date,reason,created_by)
     SELECT id,$2,$3,'MAINTENANCE',$4 FROM rooms WHERE room_type_id=$1`,
    [typeId, blocked.checkIn, blocked.checkOut, userId],
  );
  const blockedTotal = await otaTotal({ roomTypeId: typeId, ...blocked });
  for (let index = 1; index <= 6; index += 1) {
    await applyNew(`short-${index}`, {
      bookingCode: `HB129-SHORT-${index}`,
      checkIn: blocked.checkIn,
      checkOut: blocked.checkOut,
      amount: blockedTotal,
    });
  }
  const short = await rows('SELECT * FROM bookings WHERE room_type_id=$1 ORDER BY created_at', [
    typeId,
  ]);
  expect(short).toHaveLength(6);
  expect(short.every((booking) => booking.oversold === true)).toBe(true);
  for (const booking of short) expect(await assignmentsOf(text(booking.id))).toHaveLength(0);
  const grouped = await casesOf(typeId);
  expect(grouped.map((row) => dayOf(row.date))).toEqual([blocked.checkIn, '2026-12-21']);
  expect(grouped.map((row) => count(row.shortage_count))).toEqual([6, 6]);
  expect(
    grouped.every((row) => text(row.status) === 'OPEN' && text(row.property_id) === propertyId),
  ).toBe(true);

  const famDate = { checkIn: '2026-12-23', checkOut: '2026-12-24' };
  await rows(
    'INSERT INTO channel_allotments(channel_id,room_type_id,date,allotment,used) VALUES($1,$2,$3,1,0)',
    [channel, fam, famDate.checkIn],
  );
  const famTotal = await otaTotal({ roomTypeId: fam, ...famDate });
  for (let index = 1; index <= 2; index += 1) {
    await applyNew(`fam-quota-${index}`, {
      bookingCode: `HB129-FAMQ-${index}`,
      roomTypeCode: FAM_CODE,
      checkIn: famDate.checkIn,
      checkOut: famDate.checkOut,
      amount: famTotal,
    });
  }
  const famBookings = await rows('SELECT * FROM bookings WHERE room_type_id=$1', [fam]);
  expect(famBookings).toHaveLength(2);
  expect(famBookings.every((booking) => booking.oversold === false)).toBe(true);
  expect(await casesOf(fam)).toHaveLength(0);

  const beds = { checkIn: '2026-12-25', checkOut: '2026-12-27' };
  const dormType = one(await rows("SELECT id FROM room_types WHERE code='DOR'"));
  const firstBeds = await applyNew('dorm-two', {
    bookingCode: 'HB129-DORM-2',
    roomTypeCode: 'DOR',
    checkIn: beds.checkIn,
    checkOut: beds.checkOut,
    roomCount: 2,
    adults: 2,
    amount: await otaTotal({ roomTypeId: text(dormType.id), ...beds, roomCount: 2 }),
  });
  const firstAssignments = await assignmentsOf(firstBeds.bookingId);
  expect(firstAssignments).toHaveLength(2);
  expect(new Set(firstAssignments.map((row) => text(row.room_id))).size).toBe(1);
  expect(new Set(firstAssignments.map((row) => count(row.bed_no))).size).toBe(2);
  const secondBeds = await applyNew('dorm-five', {
    bookingCode: 'HB129-DORM-5',
    roomTypeCode: 'DOR',
    checkIn: beds.checkIn,
    checkOut: beds.checkOut,
    roomCount: 5,
    adults: 5,
    amount: await otaTotal({ roomTypeId: text(dormType.id), ...beds, roomCount: 5 }),
  });
  expect(one(await bookingById(secondBeds.bookingId)).oversold).toBe(true);
  expect(await assignmentsOf(secondBeds.bookingId)).toHaveLength(4);
  const dormCases = await casesOf(text(dormType.id));
  expect(dormCases.map((row) => count(row.shortage_count))).toEqual([1, 1]);

  clock.value = Date.parse('2026-12-09T12:00:00Z');
  const late = { checkIn: '2026-12-10', checkOut: '2026-12-12' };
  await rows(
    `INSERT INTO room_blocks(room_id,start_date,end_date,reason,created_by)
     SELECT id,$2,$3,'MAINTENANCE',$4 FROM rooms WHERE room_type_id=$1`,
    [typeId, late.checkIn, late.checkOut, userId],
  );
  await applyNew('late-short', {
    bookingCode: 'HB129-LATE-1',
    checkIn: late.checkIn,
    checkOut: late.checkOut,
    amount: await otaTotal({ roomTypeId: typeId, ...late }),
  });
  const escalated = (await casesOf(typeId)).filter((row) => dayOf(row.date) === late.checkIn);
  expect(escalated).toHaveLength(1);
  expect(text(escalated[0]?.status)).toBe('ESCALATED');
  expect(escalated[0]?.escalated_at).not.toBeNull();
});

test('durable-business-dedup', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const mirrored = await applyNew('dedup-account-b', {
    bookingCode: 'HB129-SAME-CODE',
    account: accountOf('booking', 1),
    amount: total,
  });
  const first = await applyNew('dedup-account-a', {
    bookingCode: 'HB129-SAME-CODE',
    amount: total,
  });
  const firstRow = one(await bookingById(first.bookingId));
  const mirroredRow = one(await bookingById(mirrored.bookingId));
  expect(text(firstRow.external_ref)).not.toBe(text(mirroredRow.external_ref));
  expect(await countBookings(channel)).toBe(2);

  const race = { checkIn: '2026-12-13', checkOut: '2026-12-14' };
  const raceTotal = await otaTotal({ roomTypeId: typeId, ...race });
  const left = await sendEvent('dedup-event-1', {
    bookingCode: 'HB129-RACE-1',
    guestPhone: '0900000199',
    amount: raceTotal,
    ...race,
  });
  const right = await sendEvent('dedup-event-2', {
    bookingCode: 'HB129-RACE-1',
    guestPhone: '0900000199',
    amount: raceTotal,
    ...race,
  });
  const results = await Promise.all([applyEvent(left.id), applyEvent(right.id)]);
  expect(results.some((result) => result.status === 'APPLIED')).toBe(true);
  expect(await countBookings(channel)).toBe(3);
  const raced = await rows('SELECT id FROM bookings WHERE channel_id=$1 AND check_in=$2', [
    channel,
    race.checkIn,
  ]);
  expect(raced).toHaveLength(1);
  const raceId = text(one(raced).id);
  expect(await paymentsOf(raceId)).toHaveLength(1);
  expect(await snapshotsOf(raceId)).toHaveLength(1);
  expect(await assignmentsOf(raceId)).toHaveLength(1);

  await rows('DELETE FROM webhook_inbox');
  const afterRetention = await sendEvent('dedup-after-retention', {
    bookingCode: 'HB129-RACE-1',
    guestPhone: '0900000199',
    amount: raceTotal,
    ...race,
  });
  expect((await applyEvent(afterRetention.id)).status).not.toBe('APPLIED');
  expect(await countBookings(channel)).toBe(3);
  expect(await paymentsOf(raceId)).toHaveLength(1);

  const phones = { checkIn: '2026-12-17', checkOut: '2026-12-18' };
  const phoneTotal = await otaTotal({ roomTypeId: typeId, ...phones });
  const duplicateA = await applyNew('dedup-phone-a', {
    bookingCode: 'HB129-PHONE-A',
    guestPhone: '0900000129',
    amount: phoneTotal,
    ...phones,
  });
  const duplicateB = await applyNew('dedup-phone-b', {
    bookingCode: 'HB129-PHONE-B',
    guestPhone: '0900000129',
    amount: phoneTotal,
    ...phones,
  });
  const flagged = one(await bookingById(duplicateB.bookingId));
  expect(flagged.duplicate_suspected).toBe(true);
  expect(flagged.cancelled_at).toBeNull();
  expect((await bookingById(duplicateA.bookingId))[0]?.duplicate_suspected).toBe(false);
  expect(await countBookings(channel)).toBe(5);
});

test('concurrent-inventory-and-unassigned-demand', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const fire = async (suffix: string, code: string): Promise<string> => {
    const { id } = await sendEvent(suffix, { bookingCode: code, amount: total });
    return id;
  };
  const firstWave = await Promise.all(
    [1, 2, 3].map((index) => fire(`con-a${index}`, `HB129-CON-A${index}`)),
  );
  const firstResults = await Promise.all(firstWave.map((id) => applyEvent(id)));
  expect(firstResults.every((result) => result.status === 'APPLIED')).toBe(true);
  const secondWave = await Promise.all(
    [4, 5].map((index) => fire(`con-b${index}`, `HB129-CON-B${index}`)),
  );
  const secondResults = await Promise.all(secondWave.map((id) => applyEvent(id)));
  expect(secondResults.every((result) => result.status === 'APPLIED')).toBe(true);

  const ledger = await rows(
    `SELECT b.id AS booking_id, b.oversold, b.status,
            count(ra.id) AS assignments, count(DISTINCT br.id) AS units
       FROM bookings b
       JOIN booking_rooms br ON br.booking_id=b.id
       LEFT JOIN room_assignments ra ON ra.booking_room_id=br.id AND ra.released_at IS NULL
      WHERE b.channel_id=$1
      GROUP BY b.id, b.oversold, b.status
      ORDER BY b.created_at`,
    [channel],
  );
  expect(ledger).toHaveLength(5);
  expect(ledger.every((row) => text(row.status) === 'CONFIRMED' && count(row.units) === 1)).toBe(
    true,
  );
  const assigned = ledger.filter((row) => count(row.assignments) > 0);
  const waiting = ledger.filter((row) => count(row.assignments) === 0);
  expect(assigned).toHaveLength(2);
  expect(assigned.every((row) => row.oversold === false)).toBe(true);
  expect(waiting).toHaveLength(3);
  expect(waiting.every((row) => row.oversold === true)).toBe(true);
  const owners = await rows(
    `SELECT DISTINCT b.id FROM room_assignments ra
       JOIN booking_rooms br ON br.id=ra.booking_room_id
       JOIN bookings b ON b.id=br.booking_id
      WHERE b.channel_id=$1 AND ra.released_at IS NULL`,
    [channel],
  );
  expect(owners).toHaveLength(2);
});

test('unmatched-event-and-service-scope', async () => {
  const channel = await channelIdOf('OTA_BOOKING');
  const total = await otaTotal({
    roomTypeId: typeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
  });
  const incidents: readonly { suffix: string; input: EventDraft }[] = [
    {
      suffix: 'unknown-property',
      input: { bookingCode: 'HB129-BAD-1', propertyCode: 'H299-NOPE', amount: total },
    },
    {
      suffix: 'unknown-room-type',
      input: { bookingCode: 'HB129-BAD-2', roomTypeCode: 'SUP', amount: total },
    },
    { suffix: 'amount-mismatch', input: { bookingCode: 'HB129-BAD-3', amount: total + 7 } },
    {
      suffix: 'unpaid',
      input: { bookingCode: 'HB129-BAD-4', amount: total, paymentCollected: false },
    },
  ];
  for (const incident of incidents) {
    const before = await countBookings(channel);
    const { id } = await sendEvent(incident.suffix, incident.input);
    const result = await applyEvent(id);
    expect(result.status, incident.suffix).toBe('QUARANTINED');
    expect(result.bookingId, incident.suffix).toBeNull();
    await expectQuarantinedInbox(id);
    expect(await countBookings(channel), incident.suffix).toBe(before);
  }

  const orphanDraft = draft({ bookingCode: 'HB129-REVOKED-1', amount: total });
  await insertInbox({
    eventId: 'hb129-ev-account-unknown',
    accountId: 'hb129-revoked-account',
    body: orphanDraft.body,
  });
  const orphan = await applyEvent('hb129-ev-account-unknown');
  expect(orphan.status).toBe('QUARANTINED');
  await expectQuarantinedInbox('hb129-ev-account-unknown');
  expect(await countBookings(channel)).toBe(0);
});
