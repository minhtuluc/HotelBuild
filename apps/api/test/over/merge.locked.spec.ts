/**
 * HB-124 giai đoạn A — khoá ghép phòng (`MERGE_SHARE` hai booking, `MERGE_CONNECTING` một booking
 * hai `BookingRoom` theo F6-D01), consent/giới tính sống trong CSDL, chiết khấu tách doanh thu
 * (F6-D03) và rollback đa bảng.
 */
import { expect, test } from 'vitest';
import {
  get,
  etagOf,
  errorCode,
  guardRoute,
  mintPin,
  post,
  rows,
  staffToken,
  withFailingInsert,
  completedKeys,
  outboxFor,
} from './helpers/harness.js';
import {
  activeAssignments,
  assignmentsOnRoom,
  chargeTotal,
  countRows,
  guests,
  mergeRow,
  refundRows,
  roomTypes,
  rooms,
  seedBooking,
  snapshotGross,
} from './helpers/seed.js';
import { mergeViewSchema } from './helpers/views.js';

const MERGES = '/api/v1/room-merges';
const SHARE_PRICES = [428_000, 513_000, 513_000];

async function shareProposal(
  primaryGuest: string,
  secondaryGuest: string,
  target = rooms.d1,
  source = rooms.d2,
) {
  const primary = await seedBooking({
    nightlyPrices: SHARE_PRICES,
    roomType: roomTypes.dorm,
    guest: primaryGuest,
    assignRoomIds: [target],
    beds: [1],
  });
  const secondary = await seedBooking({
    nightlyPrices: SHARE_PRICES,
    roomType: roomTypes.dorm,
    guest: secondaryGuest,
    assignRoomIds: [source],
    beds: [1],
  });
  const token = await staffToken('desk');
  const created = await post(MERGES, token, {
    primaryBookingId: primary.id,
    secondaryBookingId: secondary.id,
    roomId: target,
    discountPct: 20,
  });
  guardRoute(created, 'POST /room-merges');
  expect(created.status).toBe(201);
  return { primary, secondary, merge: mergeViewSchema.parse(created.body), token };
}

const consent = (
  mergeId: string,
  side: 'PRIMARY' | 'SECONDARY',
  consented: boolean,
  token: string,
) =>
  post(`${MERGES}/${mergeId}/consent`, token, {
    side,
    consented,
    ...(consented ? { evidenceUrl: 'https://evidence.local/hb124-consent' } : {}),
  });

async function consentBoth(mergeId: string, token: string): Promise<void> {
  expect((await consent(mergeId, 'PRIMARY', true, token)).status).toBe(200);
  expect((await consent(mergeId, 'SECONDARY', true, token)).status).toBe(200);
}

test('TC_OVER_11_13_18_live_consent_gender_approval', async () => {
  // Cùng giới + đủ consent: BR-OVER-13/14 không đòi duyệt MANAGER (F6-D04).
  const same = await shareProposal(guests.male, guests.male);
  expect(same.merge.status).toBe('PENDING_CONSENT');
  await consentBoth(same.merge.id, same.token);
  const sameTag = etagOf(await get(`${MERGES}/${same.merge.id}`, same.token));
  const sameDone = await post(
    `${MERGES}/${same.merge.id}/execute`,
    same.token,
    { pinToken: await mintPin('desk', same.primary.id) },
    { tag: sameTag },
  );
  expect([200, 201]).toContain(sameDone.status);
  expect(await mergeRow(same.merge.id)).toMatchObject({ status: 'ACTIVE', approved_by: null });

  // Khác giới + đủ consent nhưng chưa duyệt ⇒ E_OVER_MERGE_GENDER (không phải E_OVER_NO_CONSENT).
  const mixed = await shareProposal(guests.male, guests.female, rooms.d3, rooms.d4);
  await consentBoth(mixed.merge.id, mixed.token);
  const mixedTag = etagOf(await get(`${MERGES}/${mixed.merge.id}`, mixed.token));
  const refused = await post(
    `${MERGES}/${mixed.merge.id}/execute`,
    mixed.token,
    { pinToken: await mintPin('desk', mixed.primary.id) },
    { tag: mixedTag },
  );
  expect(refused.status).toBe(409);
  expect(errorCode(refused)).toBe('E_OVER_MERGE_GENDER');
  expect((await mergeRow(mixed.merge.id)).status).not.toBe('ACTIVE');
  const approved = await post(`${MERGES}/${mixed.merge.id}/approve`, await staffToken('manager'), {
    reason: 'Hai khách khác giới đồng ý bằng văn bản',
    pinToken: await mintPin('manager', mixed.primary.id),
  });
  expect([200, 201]).toContain(approved.status);
  const mixedFresh = etagOf(await get(`${MERGES}/${mixed.merge.id}`, mixed.token));
  const mixedDone = await post(
    `${MERGES}/${mixed.merge.id}/execute`,
    mixed.token,
    { pinToken: await mintPin('desk', mixed.primary.id) },
    { tag: mixedFresh },
  );
  expect([200, 201]).toContain(mixedDone.status);
  expect((await mergeRow(mixed.merge.id)).status).toBe('ACTIVE');

  // Consent bị rút sau khi đề xuất: DTO/If-Match cũ bị 412, đọc lại DB vẫn thiếu consent ⇒ 409.
  const withdrawn = await shareProposal(guests.female, guests.female, rooms.d5, rooms.d6);
  await consentBoth(withdrawn.merge.id, withdrawn.token);
  const staleTag = etagOf(await get(`${MERGES}/${withdrawn.merge.id}`, withdrawn.token));
  expect((await consent(withdrawn.merge.id, 'SECONDARY', false, withdrawn.token)).status).toBe(200);
  const staleExecution = await post(
    `${MERGES}/${withdrawn.merge.id}/execute`,
    withdrawn.token,
    { pinToken: await mintPin('desk', withdrawn.primary.id) },
    { tag: staleTag },
  );
  expect(staleExecution.status).toBe(412);
  const withdrawnTag = etagOf(await get(`${MERGES}/${withdrawn.merge.id}`, withdrawn.token));
  const noConsent = await post(
    `${MERGES}/${withdrawn.merge.id}/execute`,
    withdrawn.token,
    { pinToken: await mintPin('desk', withdrawn.primary.id) },
    { tag: withdrawnTag },
  );
  expect(noConsent.status).toBe(409);
  expect(errorCode(noConsent)).toBe('E_OVER_NO_CONSENT');
});

test('HB124_transaction_failure_rolls_back_all_effects', async () => {
  const proposal = await shareProposal(guests.male, guests.male);
  await consentBoth(proposal.merge.id, proposal.token);
  const tag = etagOf(await get(`${MERGES}/${proposal.merge.id}`, proposal.token));
  const pin = await mintPin('desk', proposal.primary.id);
  const failed = await withFailingInsert('audit_logs', 'hb124_merge_audit_fail', () =>
    post(`${MERGES}/${proposal.merge.id}/execute`, proposal.token, { pinToken: pin }, { tag }),
  );
  expect(failed.status).toBeGreaterThanOrEqual(500);

  const stored = await mergeRow(proposal.merge.id);
  expect(['PENDING_CONSENT', 'APPROVED']).toContain(stored.status);
  expect(stored.discount_amount).toBe('581600');
  // Nguồn chưa nhả, đích chưa nhận; không có chứng từ/outbox/idempotency dở dang.
  expect(await activeAssignments(proposal.secondary.bookingRoomIds[0]!)).toMatchObject([
    { room_id: rooms.d2, released_at: null },
  ]);
  expect(await assignmentsOnRoom(rooms.d1)).toMatchObject([
    { booking_room_id: proposal.primary.bookingRoomIds[0], bed_no: 1 },
  ]);
  expect(await outboxFor(proposal.merge.id)).toHaveLength(0);
  expect(await completedKeys(`%/room-merges/${proposal.merge.id}/execute%`)).toHaveLength(0);
  expect(await refundRows(proposal.primary.id)).toHaveLength(0);
  expect(await refundRows(proposal.secondary.id)).toHaveLength(0);
  expect(
    (await rows('SELECT version FROM room_merges WHERE id=$1', [proposal.merge.id]))[0]!.version,
  ).toBeTruthy();
});

test('HB124_merge_cost_and_correct_unit_release', async () => {
  const token = await staffToken('desk');
  const share = await shareProposal(guests.male, guests.male);
  await consentBoth(share.merge.id, share.token);
  const shareTag = etagOf(await get(`${MERGES}/${share.merge.id}`, share.token));
  const shareDone = await post(
    `${MERGES}/${share.merge.id}/execute`,
    share.token,
    { pinToken: await mintPin('desk', share.primary.id) },
    { tag: shareTag },
  );
  expect([200, 201]).toContain(shareDone.status);

  const cost = await mergeRow(share.merge.id);
  expect(cost.discount_amount).toBe('581600');
  expect(Number(cost.discount_pct)).toBe(20);
  // Doanh thu/PriceSnapshot nguyên 1.454.000 mỗi bên; nghĩa vụ phải thu floor1000 ⇒ 1.163.000.
  expect(await snapshotGross(share.primary.id)).toBe(1_454_000);
  expect(await snapshotGross(share.secondary.id)).toBe(1_454_000);
  expect(await chargeTotal(share.primary.id)).toBe(1_163_000);
  expect(await chargeTotal(share.secondary.id)).toBe(1_163_000);
  const beds = await assignmentsOnRoom(rooms.d1);
  expect(beds).toHaveLength(2);
  expect(new Set(beds.map((row) => Number(row.bed_no))).size).toBe(2);
  expect(beds).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ booking_room_id: share.primary.bookingRoomIds[0] }),
      expect.objectContaining({ booking_room_id: share.secondary.bookingRoomIds[0] }),
    ]),
  );
  expect(await activeAssignments(share.primary.bookingRoomIds[0]!)).toMatchObject([
    { room_id: rooms.d1, released_at: null },
  ]);
  // Chỉ giường thực đã rời bị nhả, phòng D2 đóng gói đúng 1 assignment cũ.
  const released = await rows(
    'SELECT released_at FROM room_assignments WHERE booking_room_id=$1 ORDER BY created_at',
    [share.secondary.bookingRoomIds[0]],
  );
  expect(released[0]!.released_at).not.toBeNull();
  expect(await countRows('SELECT id FROM bookings')).toBe(2);

  // CONNECTING: một booking, hai BookingRoom; body chỉ có bookingId + roomIdA/roomIdB (F6-D01).
  const connect = await seedBooking({
    nightlyPrices: [1_530_000, 1_836_000],
    spaces: 2,
    roomType: roomTypes.connecting,
    assignRoomIds: [rooms.c1, rooms.c2],
  });
  const before = await countRows('SELECT id FROM bookings');
  const created = await post(MERGES, token, {
    bookingId: connect.id,
    roomIdA: rooms.c1,
    roomIdB: rooms.c2,
  });
  guardRoute(created, 'POST /room-merges');
  expect(created.status).toBe(201);
  const view = mergeViewSchema.parse(created.body);
  expect(view.secondaryBookingId ?? null).toBeNull();
  const connectTag = etagOf(await get(`${MERGES}/${view.id}`, token));
  const connected = await post(
    `${MERGES}/${view.id}/execute`,
    token,
    { pinToken: await mintPin('desk', connect.id) },
    { tag: connectTag },
  );
  expect([200, 201]).toContain(connected.status);
  const row = await mergeRow(view.id);
  expect(row.secondary_booking_id).toBeNull();
  expect(row.secondary_room_id).toBe(rooms.c2);
  expect(row.discount_amount).toBe('673200');
  expect(Number(row.discount_pct)).toBe(10);
  expect(await snapshotGross(connect.id)).toBe(6_732_000);
  expect(await chargeTotal(connect.id)).toBe(6_058_000);
  expect(await countRows('SELECT id FROM bookings')).toBe(before);
  expect(await countRows('SELECT id FROM bookings WHERE id=$1', [connect.id])).toBe(1);
  // Không có booking con/partial-cancel: chỉ một snapshot ORIGINAL.
  expect(await countRows('SELECT id FROM price_snapshots WHERE booking_id=$1', [connect.id])).toBe(
    1,
  );
  expect(await refundRows(connect.id)).toHaveLength(0);
});
