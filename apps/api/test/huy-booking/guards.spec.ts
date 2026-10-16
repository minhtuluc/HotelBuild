/**
 * HB-097 — cổng chặn biên: hạn mức hoàn (BR-CANCEL-17), bất khả kháng (BR-CANCEL-13),
 * phí xử lý hoàn (BR-CANCEL-05,11) và mã lỗi hợp đồng api.md §3.3.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { cancelPreviewSchema, cancelResponseSchema } from '@pinehill/contracts';
import {
  auditCount,
  booking,
  bookingRow,
  cancel,
  errorCode,
  guestCancel,
  heldAmount,
  login,
  pay,
  preview,
  propertyId,
  refundRequests,
  rows,
  setFee,
  userId,
} from './fixture.js';

describe('HB-097 cổng chặn huỷ', () => {
  test('BR-CANCEL-17: hạn mức hoàn đang giữ của sự kiện khác ⇒ 422 và rollback toàn bộ', async () => {
    const token = await login('FRONT_DESK');
    const held = await booking({ price: 300_000 });
    const payment = await pay(held.id, 300_000n);
    const request = String(
      (
        await rows(
          `INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,refund_percent,
              requested_amount,refund_fee,reason,requester_type,requester_id)
           SELECT $1,'late-payment',cancellation_policy_id,100,100,300000,0,'PAYMENT_TIMEOUT','SYSTEM','scheduler'
             FROM rate_plans WHERE code='FLEX7' RETURNING id`,
          [held.id],
        )
      )[0]!.id,
    );
    await rows(
      'INSERT INTO refund_allocations(refund_request_id,original_payment_id,amount) VALUES($1::uuid,$2::uuid,300000)',
      [request, payment],
    );
    const before = await bookingRow(held.id);
    const blocked = await cancel(token, held.id, guestCancel);
    expect(blocked.status).toBe(422);
    expect(errorCode(blocked.body)).toBe('E_PAY_REFUND_EXCEEDS_PAID');
    expect(await bookingRow(held.id)).toEqual(before);
    expect(await refundRequests(held.id)).toHaveLength(1);
    expect(await auditCount(held.id, 'BOOKING_CANCELLED')).toBe(0);
    expect(await rows('SELECT released_at FROM room_assignments')).toEqual([]);
  });

  test('BR-CANCEL-13: bất khả kháng chỉ MANAGER/OWNER, note ≥ 20 ký tự, hoàn 100% cơ sở, miễn phí/phạt', async () => {
    const front = await login('FRONT_DESK');
    const forced = await booking({ nights: 3, price: 100_000 });
    await pay(forced.id, 5_001n);
    const evidence = 'Bão lớn tại khu vực, khách không thể tới';
    const denied = await cancel(front, forced.id, {
      reason: 'FORCE_MAJEURE',
      isForceMajeure: true,
      note: evidence,
      evidenceRefs: ['ev-1'],
    });
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('E_PAY_REFUND_FORCE_MAJEURE_FORBIDDEN');

    const manager = await login('MANAGER');
    const short = await cancel(manager, forced.id, {
      reason: 'FORCE_MAJEURE',
      isForceMajeure: true,
      note: 'Bão',
    });
    expect(short.status).toBe(400);
    expect(errorCode(short.body)).toBe('E_PAY_REASON_TOO_SHORT');

    await setFee(1_000);
    const accepted = await cancel(manager, forced.id, {
      reason: 'FORCE_MAJEURE',
      isForceMajeure: true,
      note: evidence,
      evidenceRefs: ['ev-1'],
    });
    expect(accepted.status).toBe(200);
    expect(cancelResponseSchema.parse(accepted.body).cancellation).toMatchObject({
      requestedAmount: 5_001,
      penaltyAmount: 0,
      refundFee: 0,
    });
    expect(await refundRequests(forced.id)).toEqual([
      expect.objectContaining({
        is_force_majeure: true,
        refund_fee: '0',
        requested_amount: '5001',
        evidence_refs: ['ev-1'],
        reason: 'FORCE_MAJEURE',
      }),
    ]);
  });

  test('phí hoàn trừ vào hạn mức giữ; trạng thái, thân lệnh, phạm vi cơ sở bị từ chối đúng mã', async () => {
    const token = await login('FRONT_DESK');
    await setFee(1_000);
    const fee = await booking({ price: 500_000 });
    await pay(fee.id, 500_000n);
    const feePreview = await preview(token, fee.id);
    expect(cancelPreviewSchema.parse(feePreview.body).cancellation).toMatchObject({
      requestedAmount: 500_000,
      refundFee: 1_000,
    });
    const withFee = await cancel(token, fee.id, guestCancel, { tag: feePreview.headers.etag! });
    expect(withFee.status).toBe(200);
    expect(await refundRequests(fee.id)).toEqual([
      expect.objectContaining({
        requested_amount: '500000',
        refund_fee: '1000',
        net_refund: '499000',
      }),
    ]);
    expect(await heldAmount(fee.id)).toBe('499000');

    const checkedIn = await booking({ status: 'CHECKED_IN' });
    const invalidState = await cancel(token, checkedIn.id, guestCancel);
    expect(invalidState.status).toBe(409);
    expect(errorCode(invalidState.body)).toBe('E_CANCEL_NOT_ALLOWED');

    const wrongBody = await cancel(token, checkedIn.id, { reason: 'GUEST_REQUEST' });
    expect(wrongBody.status).toBe(400);
    expect(errorCode(wrongBody.body)).toBe('E_GEN_VALIDATION_FAILED');
    const badPreview = await preview(token, checkedIn.id, { reason: 'GUEST_REQUEST' });
    expect(badPreview.status).toBe(400);

    const unknown = await cancel(token, randomUUID(), guestCancel);
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown.body)).toBe('E_GEN_NOT_FOUND');

    const outside = await booking();
    await rows('DELETE FROM user_property_scopes WHERE user_id=$1::uuid AND property_id=$2::uuid', [
      userId,
      propertyId,
    ]);
    const scoped = await cancel(token, outside.id, guestCancel);
    expect(scoped.status).toBe(403);
    expect(errorCode(scoped.body)).toBe('E_AUTH_OUT_OF_SCOPE');
  });
});
