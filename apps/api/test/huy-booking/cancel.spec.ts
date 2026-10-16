/**
 * HB-097 — `cancel-preview` + `cancel` trên PostgreSQL 16 thật, HTTP thật (engine/ledger thật, không mock).
 * AC1 xem trước thuần đọc + kiểm lại neo trong transaction; AC2 hoàn theo QĐ-05/bậc + phụ thu đêm đầu;
 * AC3 nhả assignment + `refund_requests`/`refund_allocations` + audit; AC4 TC-BOOK-27 huỷ hai phòng liên tiếp.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { cancelPreviewSchema, cancelResponseSchema } from '@pinehill/contracts';
import {
  assign,
  auditCount,
  booking,
  bookingRow,
  cancel,
  clock,
  db,
  errorCode,
  guestCancel,
  heldAmount,
  ledger,
  login,
  pay,
  preview,
  refundRequests,
  room2Id,
  roomId,
  rows,
  userId,
} from './fixture.js';

describe('HB-097 huỷ booking', () => {
  test('AC1+AC3: xem trước không ghi gì; huỷ toàn phần nhả assignment, lập yêu cầu hoàn + audit, replay không nhân đôi', async () => {
    const token = await login('FRONT_DESK');
    const held = await booking({ price: 500_000 });
    const [physicalRoom, bookingRoom] = [...held.rooms.entries()][0]!;
    await pay(held.id, 500_000n);
    const assignment = await assign(bookingRoom, physicalRoom, held.checkIn, held.checkOut);
    const before = await bookingRow(held.id);

    const previewed = await preview(token, held.id);
    expect(previewed.status).toBe(200);
    const body = cancelPreviewSchema.parse(previewed.body);
    expect(body.bookingId).toBe(held.id);
    expect(body.currency).toBe('VND');
    expect(body.cancellation.hoursBeforeCheckIn).toBeGreaterThan(500);
    expect(body.cancellation).toMatchObject({
      refundPercent: 100,
      requestedAmount: 500_000,
      paidAmount: 500_000,
      penaltyAmount: 0,
      refundFee: 0,
    });
    expect(previewed.headers.etag).toBeTruthy();
    // AC1: xem trước không đổi trạng thái/version/tiền và không sinh hàng nào.
    expect(await bookingRow(held.id)).toEqual(before);
    expect(await refundRequests(held.id)).toEqual([]);
    expect(await auditCount(held.id, 'BOOKING_CANCELLED')).toBe(0);

    const key = randomUUID();
    const cancelled = await cancel(
      token,
      held.id,
      { ...guestCancel, note: 'Khách đổi kế hoạch' },
      { tag: previewed.headers.etag!, key },
    );
    expect(cancelled.status).toBe(200);
    const result = cancelResponseSchema.parse(cancelled.body);
    expect(result).toMatchObject({
      bookingId: held.id,
      status: 'CANCELLED',
      cancelReason: 'GUEST_REQUEST',
      releasedAssignmentCount: 1,
    });
    expect(result.refundRequest).toMatchObject({ status: 'PENDING', approvedAmount: null });
    expect(result.refundRequest!.id).toBeTruthy();

    const after = await bookingRow(held.id);
    expect(after).toMatchObject({
      status: 'CANCELLED',
      cancel_reason: 'GUEST_REQUEST',
      total_amount: '0',
      penalty_amount: '0',
    });
    expect(after.cancelled_at).not.toBeNull();
    // Hai lần ghi bản ghi booking: chuyển trạng thái và đồng bộ projection của ledger.
    expect(Number(after.version)).toBeGreaterThan(Number(before.version));
    expect(
      await rows('SELECT status,cancelled_at IS NOT NULL AS done FROM booking_rooms WHERE id=$1', [
        bookingRoom,
      ]),
    ).toEqual([{ status: 'CANCELLED', done: true }]);
    expect(
      await rows(
        'SELECT count(*) AS n FROM booking_charges WHERE booking_id=$1 AND voided_amount=amount',
        [held.id],
      ),
    ).toEqual([{ n: '3' }]);
    expect(
      await rows(
        `SELECT count(*) AS n FROM payment_allocations a JOIN booking_charges c ON c.id=a.charge_id
          WHERE c.booking_id=$1 AND a.released_amount=a.amount`,
        [held.id],
      ),
    ).toEqual([{ n: '3' }]);
    expect(
      await rows(
        'SELECT released_at IS NOT NULL AS done,release_reason FROM room_assignments WHERE id=$1',
        [assignment],
      ),
    ).toEqual([{ done: true, release_reason: 'GUEST_REQUEST' }]);
    expect(
      await rows(
        `SELECT event_key,status,refund_percent,requested_amount,refund_fee,net_refund,requester_type,
                requester_id,reason,is_force_majeure,evidence_refs,approved_amount,decided_at,paid_at,
                applied_tier_id IS NOT NULL AS tier,payment_id IS NOT NULL AS has_payment
           FROM refund_requests WHERE booking_id=$1`,
        [held.id],
      ),
    ).toEqual([
      {
        event_key: `cancel:${bookingRoom}`,
        status: 'PENDING',
        refund_percent: '100.00',
        requested_amount: '500000',
        refund_fee: '0',
        net_refund: '500000',
        requester_type: 'USER',
        requester_id: userId,
        reason: 'GUEST_REQUEST',
        is_force_majeure: false,
        evidence_refs: [],
        approved_amount: null,
        decided_at: null,
        paid_at: null,
        tier: true,
        has_payment: true,
      },
    ]);
    expect(await heldAmount(held.id)).toBe('500000');
    expect(await auditCount(held.id, 'BOOKING_CANCELLED')).toBe(1);
    expect(await auditCount(held.id, 'LEDGER_REFUND_RESERVED')).toBe(1);
    expect(
      await rows('SELECT to_status,from_status FROM booking_status_history WHERE booking_id=$1', [
        held.id,
      ]),
    ).toEqual([{ to_status: 'CANCELLED', from_status: 'CONFIRMED' }]);
    expect(await db.$transaction((tx) => ledger.read(tx, held.id))).toMatchObject({
      paidAmount: 500_000n,
      refundedAmount: 0n,
      refundReserved: 500_000n,
    });

    const replay = await cancel(
      token,
      held.id,
      { ...guestCancel, note: 'Khách đổi kế hoạch' },
      { tag: previewed.headers.etag!, key },
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(cancelled.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await refundRequests(held.id)).toHaveLength(1);
  });

  test('AC1: neo xem trước lệch version hoặc lệch bậc ⇒ 412 (phải xem trước lại); thiếu If-Match vẫn huỷ được', async () => {
    const token = await login('FRONT_DESK');
    const moved = await booking({ checkIn: '2026-10-12', nights: 2, price: 400_000 });
    await pay(moved.id, 100_000n);
    const stale = await preview(token, moved.id);
    expect(stale.status).toBe(200);
    expect(cancelPreviewSchema.parse(stale.body).cancellation.refundPercent).toBe(50);

    await rows('UPDATE bookings SET note=$2 WHERE id=$1', [moved.id, 'đổi lịch sử']);
    const conflict = await cancel(token, moved.id, guestCancel, { tag: stale.headers.etag! });
    expect(conflict.status).toBe(412);
    expect(errorCode(conflict.body)).toBe('E_GEN_VERSION_CONFLICT');

    const malformed = await cancel(token, moved.id, guestCancel, { tag: '"khong-phai-version"' });
    expect(malformed.status).toBe(428);
    expect(errorCode(malformed.body)).toBe('E_GEN_PRECONDITION_REQUIRED');

    // Qua mốc giờ sang bậc bắt tất (<24h, phụ thu đêm đầu) nhưng version chưa đổi.
    clock.value += 5 * 86_400_000;
    const later = await login('FRONT_DESK');
    const drifted = await cancel(later, moved.id, guestCancel, { tag: stale.headers.etag! });
    expect(drifted.status).toBe(412);
    expect(errorCode(drifted.body)).toBe('E_GEN_VERSION_CONFLICT');
    expect(await bookingRow(moved.id)).toMatchObject({
      status: 'CONFIRMED',
      total_amount: '800000',
    });

    const fresh = await preview(later, moved.id);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.etag).not.toBe(stale.headers.etag);
    expect(cancelPreviewSchema.parse(fresh.body).cancellation).toMatchObject({
      refundPercent: 0,
      requestedAmount: 0,
      penaltyAmount: 300_000,
    });
    const confirmed = await cancel(later, moved.id, guestCancel, { tag: fresh.headers.etag! });
    expect(confirmed.status).toBe(200);
    expect(cancelResponseSchema.parse(confirmed.body).refundRequest).toBeNull();
    expect(await refundRequests(moved.id)).toEqual([]);
    expect(await bookingRow(moved.id)).toMatchObject({
      status: 'CANCELLED',
      penalty_amount: '300000',
    });

    const again = await booking({ checkIn: '2026-10-12', nights: 2, price: 400_000 });
    await pay(again.id, 400_000n);
    const anchored = await preview(later, again.id);
    expect(anchored.headers.etag).toBeTruthy();
    const withoutAnchor = await cancel(later, again.id, guestCancel);
    expect(withoutAnchor.status).toBe(200);
    expect(cancelResponseSchema.parse(withoutAnchor.body).status).toBe('CANCELLED');
    expect(await refundRequests(again.id)).toEqual([]);
  });

  test('AC2: booking chưa xác nhận hoàn đúng số đã thu (không làm tròn); đã xác nhận làm tròn xuống bội 1.000', async () => {
    const token = await login('FRONT_DESK');
    const held = await booking({ status: 'HELD', nights: 3, price: 100_000 });
    await pay(held.id, 5_001n);
    const previewed = await preview(token, held.id);
    expect(cancelPreviewSchema.parse(previewed.body).cancellation).toMatchObject({
      refundPercent: 100,
      requestedAmount: 5_001,
      penaltyAmount: 0,
      refundFee: 0,
    });
    const cancelled = await cancel(token, held.id, guestCancel, { tag: previewed.headers.etag! });
    expect(cancelled.status).toBe(200);
    expect(cancelResponseSchema.parse(cancelled.body).cancellation.requestedAmount).toBe(5_001);
    expect(await refundRequests(held.id)).toEqual([
      expect.objectContaining({
        requested_amount: '5001',
        net_refund: '5001',
        applied_tier_id: null,
        refund_percent: '100.00',
      }),
    ]);
    expect(await bookingRow(held.id)).toMatchObject({ status: 'CANCELLED', paid_amount: '5001' });

    const confirmed = await booking({ nights: 3, price: 100_000 });
    await pay(confirmed.id, 5_001n);
    const previewedConfirmed = await preview(token, confirmed.id);
    expect(cancelPreviewSchema.parse(previewedConfirmed.body).cancellation.requestedAmount).toBe(
      5_000,
    );
    const done = await cancel(token, confirmed.id, guestCancel, {
      tag: previewedConfirmed.headers.etag!,
    });
    expect(cancelResponseSchema.parse(done.body).cancellation.requestedAmount).toBe(5_000);
    expect(await refundRequests(confirmed.id)).toEqual([
      expect.objectContaining({ requested_amount: '5000' }),
    ]);
    expect(
      await rows(
        'SELECT applied_tier_id IS NOT NULL AS tier FROM refund_requests WHERE booking_id=$1',
        [confirmed.id],
      ),
    ).toEqual([{ tier: true }]);
  });

  test('AC2: bậc bắt tất ghi phụ thu đêm đầu thành công nợ PENALTY PENDING, không tự thu', async () => {
    const token = await login('FRONT_DESK');
    const soon = await booking({ checkIn: '2026-10-09', nights: 1, price: 1_000_000 });
    await pay(soon.id, 200_000n);
    const previewed = await preview(token, soon.id);
    expect(cancelPreviewSchema.parse(previewed.body).cancellation).toMatchObject({
      refundPercent: 0,
      requestedAmount: 0,
      penaltyAmount: 800_000,
    });
    const cancelled = await cancel(token, soon.id, guestCancel, { tag: previewed.headers.etag! });
    expect(cancelled.status).toBe(200);
    const result = cancelResponseSchema.parse(cancelled.body);
    expect(result.cancellation).toMatchObject({
      requestedAmount: 0,
      penaltyAmount: 800_000,
      refundFee: 0,
    });
    expect(result.refundRequest).toBeNull();
    expect(await bookingRow(soon.id)).toMatchObject({
      status: 'CANCELLED',
      total_amount: '0',
      penalty_amount: '800000',
      balance_due: '800000',
      paid_amount: '200000',
    });
    expect(
      await rows(
        "SELECT kind,amount,voided_amount FROM booking_charges WHERE booking_id=$1 AND kind='PENALTY'",
        [soon.id],
      ),
    ).toEqual([{ kind: 'PENALTY', amount: '800000', voided_amount: '0' }]);
    expect(
      await rows(
        "SELECT type,method,amount,status FROM payments WHERE booking_id=$1 AND type='PENALTY'",
        [soon.id],
      ),
    ).toEqual([{ type: 'PENALTY', method: 'CASH', amount: '800000', status: 'PENDING' }]);
  });

  test('AC4/TC-BOOK-27: huỷ hai phòng liên tiếp không vượt tổng đã thu; phòng còn lại giữ giá + assignment', async () => {
    const token = await login('FRONT_DESK');
    const two = await booking({ rooms: [roomId, room2Id], nights: 3, price: 100_000 });
    expect(two.total).toBe(600_000n);
    const [firstPhysical, firstRoom] = [...two.rooms.entries()][0]!;
    const [secondPhysical, secondRoom] = [...two.rooms.entries()][1]!;
    const firstAssignment = await assign(firstRoom, firstPhysical, two.checkIn, two.checkOut);
    const secondAssignment = await assign(secondRoom, secondPhysical, two.checkIn, two.checkOut);
    await pay(two.id, 600_000n);

    const partial = await cancel(
      token,
      two.id,
      { ...guestCancel, bookingRoomIds: [firstRoom] },
      { tag: (await preview(token, two.id)).headers.etag! },
    );
    expect(partial.status).toBe(200);
    const partialResult = cancelResponseSchema.parse(partial.body);
    expect(partialResult.status).toBe('CONFIRMED');
    expect(partialResult.cancellation.requestedAmount).toBe(300_000);
    expect(partialResult.releasedAssignmentCount).toBe(1);
    expect(await bookingRow(two.id)).toMatchObject({ status: 'CONFIRMED', total_amount: '300000' });
    expect(
      await rows(
        'SELECT seq,kind,gross_amount FROM price_snapshots WHERE booking_id=$1 ORDER BY seq',
        [two.id],
      ),
    ).toEqual([
      { seq: 1, kind: 'ORIGINAL', gross_amount: '600000' },
      { seq: 2, kind: 'PARTIAL_CANCEL', gross_amount: '300000' },
    ]);
    expect(
      await rows(
        "SELECT jsonb_array_length(payload_json->'nights') AS nights FROM price_snapshots WHERE booking_id=$1 AND seq=2",
        [two.id],
      ),
    ).toEqual([{ nights: 3 }]);
    // AC3: chỉ nhả assignment của phòng bị huỷ; phòng còn lại giữ nguyên.
    expect(
      await rows('SELECT released_at IS NOT NULL AS done FROM room_assignments WHERE id=$1', [
        firstAssignment,
      ]),
    ).toEqual([{ done: true }]);
    expect(
      await rows('SELECT released_at IS NULL AS open FROM room_assignments WHERE id=$1', [
        secondAssignment,
      ]),
    ).toEqual([{ open: true }]);

    const rest = await cancel(token, two.id, guestCancel);
    expect(rest.status).toBe(200);
    expect(cancelResponseSchema.parse(rest.body).status).toBe('CANCELLED');
    expect(await bookingRow(two.id)).toMatchObject({ status: 'CANCELLED', total_amount: '0' });
    expect(await heldAmount(two.id)).toBe('600000');
    const projection = await db.$transaction((tx) => ledger.read(tx, two.id));
    expect(projection.refundReserved).toBe(600_000n);
    expect(projection.refundReserved + projection.refundedAmount).toBeLessThanOrEqual(
      projection.paidAmount,
    );

    const third = await cancel(token, two.id, { ...guestCancel, bookingRoomIds: [firstRoom] });
    expect(third.status).toBe(409);
    expect(errorCode(third.body)).toBe('E_CANCEL_NOT_ALLOWED');
  });
});
