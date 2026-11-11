/**
 * HB-234 — QA HB-194 QA-F6-13. Quyết định người dùng 11/11/2026: tạo yêu cầu hoàn tiền.
 *
 * Ghép `MERGE_SHARE` giảm nghĩa vụ phòng (chiết khấu 20%), trong khi khách đã trả đủ giá cũ. Trước đây
 * phần trả thừa không có hồ sơ hoàn. Nay mỗi booking trả thừa có đúng một hồ sơ `HOTEL_RELOCATION`
 * PENDING bằng đúng phần thừa, phí 0, giữ chỗ trên sổ cái. Booking chưa trả thừa thì không có hồ sơ.
 */
import { expect, test } from 'vitest';
import { etagOf, get, mintPin, post, rows, staffToken } from './helpers/harness.js';
import { chargeTotal, guests, refundRows, roomTypes, rooms, seedBooking } from './helpers/seed.js';
import { mergeViewSchema } from './helpers/views.js';

const MERGES = '/api/v1/room-merges';
const PRICES = [428_000, 513_000, 513_000];
const FULL = PRICES.reduce((sum, price) => sum + price, 0);

async function executeShare(
  primaryPaid: number,
  secondaryPaid: number,
  target: string,
  source: string,
) {
  const primary = await seedBooking({
    nightlyPrices: PRICES,
    roomType: roomTypes.dorm,
    guest: guests.male,
    assignRoomIds: [target],
    beds: [1],
    ...(primaryPaid > 0 ? { paid: [{ amount: primaryPaid, method: 'CASH' as const }] } : {}),
  });
  const secondary = await seedBooking({
    nightlyPrices: PRICES,
    roomType: roomTypes.dorm,
    guest: guests.male,
    assignRoomIds: [source],
    beds: [1],
    ...(secondaryPaid > 0 ? { paid: [{ amount: secondaryPaid, method: 'CASH' as const }] } : {}),
  });
  const token = await staffToken('desk');
  const created = await post(MERGES, token, {
    primaryBookingId: primary.id,
    secondaryBookingId: secondary.id,
    roomId: target,
    discountPct: 20,
  });
  expect(created.status).toBe(201);
  const merge = mergeViewSchema.parse(created.body);
  for (const side of ['PRIMARY', 'SECONDARY'] as const)
    expect(
      (
        await post(`${MERGES}/${merge.id}/consent`, token, {
          side,
          consented: true,
          evidenceUrl: 'https://evidence.local/hb234-consent',
        })
      ).status,
    ).toBe(200);
  const tag = etagOf(await get(`${MERGES}/${merge.id}`, token));
  const done = await post(
    `${MERGES}/${merge.id}/execute`,
    token,
    { pinToken: await mintPin('desk', primary.id) },
    { tag },
  );
  expect([200, 201]).toContain(done.status);
  return { primary, secondary, mergeId: merge.id };
}

const reservedFor = async (refundId: string) =>
  Number(
    (
      await rows(
        'SELECT coalesce(sum(amount),0)::text AS total FROM refund_allocations WHERE refund_request_id=$1',
        [refundId],
      )
    )[0]?.total ?? 0,
  );

test('HB234_paid_in_full_merge_creates_pending_refund_for_the_overpayment', async () => {
  const { primary, secondary, mergeId } = await executeShare(FULL, FULL, rooms.d1, rooms.d2);
  for (const booking of [primary, secondary]) {
    const obligation = await chargeTotal(booking.id);
    expect(obligation).toBeLessThan(FULL);
    const refunds = await refundRows(booking.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      reason: 'HOTEL_RELOCATION',
      status: 'PENDING',
      event_key: `merge:${mergeId}`,
      requested_amount: String(FULL - obligation),
      refund_fee: '0',
    });
    expect(await reservedFor(String(refunds[0]!.id))).toBe(FULL - obligation);
    const [row] = await rows('SELECT balance_due::text AS due FROM bookings WHERE id=$1', [
      booking.id,
    ]);
    expect(row?.due).toBe('0');
  }
});

test('HB234_no_refund_when_guest_has_not_overpaid', async () => {
  // Bên chính chưa trả gì; bên phụ chỉ trả cọc nhỏ hơn nghĩa vụ mới ⇒ không bên nào trả thừa.
  const { primary, secondary } = await executeShare(0, 300_000, rooms.d3, rooms.d4);
  expect(await refundRows(primary.id)).toHaveLength(0);
  expect(await refundRows(secondary.id)).toHaveLength(0);
});

test('HB234_merge_refund_goes_through_existing_two_level_approval', async () => {
  const { primary } = await executeShare(FULL, FULL, rooms.d5, rooms.d6);
  const [refund] = await refundRows(primary.id);
  const amount = Number(refund!.requested_amount);
  const approved = await post(
    `/api/v1/refund-requests/${String(refund!.id)}/approve`,
    await staffToken('manager'),
    {
      approvedAmount: amount,
      pinToken: await mintPin('manager', primary.id),
      note: 'Hoàn chiết khấu ghép phòng',
    },
  );
  expect(approved.status).toBe(200);
  expect((await refundRows(primary.id))[0]).toMatchObject({
    status: 'APPROVED',
    approved_amount: String(amount),
  });
});
