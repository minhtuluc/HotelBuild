/**
 * HB-124 giai đoạn A — khoá walk-out: chứng từ/chữ ký, hoàn theo BR-CANCEL-05/11/14 (F6-D02),
 * maker–checker/quỹ hoàn, replay + PSP timeout, và ca booking chưa gán phòng vẫn tạo demand.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { refundRequestSchema } from '@pinehill/contracts';
import {
  completedKeys,
  errorCode,
  etagOf,
  get,
  guardRoute,
  mintPin,
  outboxFor,
  post,
  rows,
  setSetting,
  staffToken,
  withFailingInsert,
} from './helpers/harness.js';
import {
  chargeTotal,
  countRows,
  day,
  D,
  bookingRow,
  moveRow,
  paymentRows,
  refundRows,
  roomTypes,
  rooms,
  seedBooking,
  seedCase,
  type SeededBooking,
} from './helpers/seed.js';
import { moveViewSchema } from './helpers/views.js';
import {
  heldAmount,
  operations,
  refundPayments,
  runPayoutJob,
  simulatorTransfers,
  type PayoutGateway,
} from './helpers/payouts.js';

const MOVES = '/api/v1/room-moves';
const REFUNDS = '/api/v1/refund-requests';
const RESOLVE = (caseId: string) => `/api/v1/overbooking-cases/${caseId}/resolve`;

interface WalkoutOptions {
  readonly overbookingCaseId?: string;
  readonly reason?: string;
}

async function proposeWalkout(booking: SeededBooking, token: string, options: WalkoutOptions = {}) {
  const created = await post(MOVES, token, {
    ...(options.overbookingCaseId === undefined
      ? {}
      : { overbookingCaseId: options.overbookingCaseId }),
    bookingId: booking.id,
    bookingRoomId: booking.bookingRoomIds[0],
    moveType: 'WALK_OUT',
    reason: options.reason ?? 'Khách sạn hết phòng phù hợp — di dời theo BR-CANCEL-14',
    compensationAmount: booking.nightlyPrices[0] ?? 0,
    transportCost: 0,
    walkOutDocNo: `BB-124-${booking.id.slice(0, 4)}`,
    guestSignatureRef: 'esign:guest:hb124',
    staffSignatureRef: 'esign:staff:hb124',
  });
  guardRoute(created, 'POST /room-moves');
  expect(created.status).toBe(201);
  const view = moveViewSchema.parse(created.body);
  const approved = await post(`${MOVES}/${view.id}/approve`, await staffToken('manager'), {
    compensationAmount: view.compensationAmount,
    transportCost: 0,
    note: 'Duyệt chi bồi thường walk-out BR-OVER-06',
    pinToken: await mintPin('manager', booking.id),
  });
  expect([200, 201]).toContain(approved.status);
  return view;
}

const executeWalkout = (
  view: { id: string },
  token: string,
  body: object,
  options: { tag?: string; key?: string } = {},
) =>
  post(`${MOVES}/${view.id}/execute`, token, body, {
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.tag === undefined ? {} : { tag: options.tag }),
  });

test('TC_OVER_07_documents_refund_compensation_separated', async () => {
  await setSetting('refund.feeAmount', '1000');
  const booking = await seedBooking({
    nightlyPrices: [2_000_000, 500_000, 500_000],
    assignRoomIds: [rooms.r1],
    // Nguồn VNPAY ⇒ leg chi tự động qua PSP mô phỏng; BANK_TRANSFER cố ý dừng chờ đối soát tay.
    paid: [{ amount: 5_001, method: 'VNPAY' }],
  });
  const token = await staffToken('desk');
  const view = await proposeWalkout(booking, token);
  const tag = etagOf(await get(`${MOVES}/${view.id}`, token));
  const executed = await executeWalkout(
    view,
    token,
    { pinToken: await mintPin('desk', booking.id) },
    { tag },
  );
  expect([200, 201]).toContain(executed.status);

  const walked = await moveRow(view.id);
  expect(walked.move_type).toBe('WALK_OUT');
  expect(walked.status).toBe('EXECUTED');
  expect(walked.price_locked).toBe(true);
  expect(String(walked.compensation_amount)).toBe('2000000');
  expect(String(walked.walk_out_doc_no).length).toBeGreaterThan(0);
  expect(String(walked.guest_signature_ref).length).toBeGreaterThan(0);
  expect(String(walked.staff_signature_ref).length).toBeGreaterThan(0);
  expect(await bookingRow(booking.id)).toMatchObject({
    status: 'CANCELLED',
    cancel_reason: 'HOTEL_RELOCATION',
    paid_amount: '5001',
  });
  const refunds = await refundRows(booking.id);
  expect(refunds).toHaveLength(1);
  const refund = refunds[0]!;
  expect(refund).toMatchObject({
    status: 'PENDING',
    reason: 'HOTEL_RELOCATION',
    refund_fee: '1000',
    requested_amount: '5000',
    net_refund: '4000',
  });
  // "Hoàn 100%" là refundPercent=100 trên refundBase, không phải trả đúng 5.001 hay miễn phí.
  expect(Number(refund.refund_percent)).toBe(100);
  const receipts = await paymentRows(booking.id);
  const original = receipts.find((receipt) => receipt.type === 'DEPOSIT')!;
  expect(refund.payment_id).toBe(original.id);
  expect(original).toMatchObject({ amount: '5001', status: 'SUCCEEDED' });
  expect(
    await countRows("SELECT id FROM payments WHERE booking_id=$1 AND type='COMPENSATION'", [
      booking.id,
    ]),
  ).toBe(0);
});

test('HB124_refund_maker_checker_fund_lock_and_threshold', async () => {
  await setSetting('refund.feeAmount', '1000');
  const manager = await staffToken('manager');
  const booking = await seedBooking({
    nightlyPrices: [2_000_000, 500_000, 500_000],
    assignRoomIds: [rooms.r1],
    paid: [{ amount: 5_001 }],
  });
  const token = await staffToken('desk');
  const move = await proposeWalkout(booking, token);
  const tag = etagOf(await get(`${MOVES}/${move.id}`, token));
  expect([200, 201]).toContain(
    (await executeWalkout(move, token, { pinToken: await mintPin('desk', booking.id) }, { tag }))
      .status,
  );
  const refundId = String((await refundRows(booking.id))[0]!.id);
  const approveBody = {
    approvedAmount: 4_000,
    note: 'Duyệt hoàn walk-out theo BR-CANCEL-14',
  };
  const accountantDenied = await post(
    `${REFUNDS}/${refundId}/approve`,
    await staffToken('accountant'),
    {
      ...approveBody,
      pinToken: await mintPin('accountant', booking.id),
    },
  );
  expect(accountantDenied.status).toBe(403);
  const approved = await post(`${REFUNDS}/${refundId}/approve`, manager, {
    ...approveBody,
    pinToken: await mintPin('manager', booking.id),
  });
  expect(approved.status).toBe(200);
  expect(refundRequestSchema.parse(approved.body).status).toBe('APPROVED');
  expect((await refundRows(booking.id))[0]!.status).toBe('APPROVED');
  expect(await heldAmount(booking.id)).toBe('4000');

  const cashier = await staffToken('accountant');
  const paid = await post(`${REFUNDS}/${refundId}/pay`, cashier, {
    method: 'BANK_TRANSFER',
    bankNote: 'STK 0123456789 — HB124',
    pinToken: await mintPin('accountant', booking.id),
  });
  expect(paid.status).toBe(202);
  // PSP chỉ chạy ở worker, không gọi trong transaction của lệnh chi.
  expect(await simulatorTransfers()).toHaveLength(0);
  const refundPays = await refundPayments(booking.id);
  expect(refundPays).toHaveLength(1);
  expect(refundPays[0]).toMatchObject({ type: 'REFUND', amount: '-4000', status: 'PENDING' });
  expect((await paymentRows(booking.id)).find((line) => line.type === 'DEPOSIT')).toMatchObject({
    amount: '5001',
  });

  // Ngưỡng xét trên tổng sự kiện: hai nguồn thu cùng booking, không tách né 5.000.000.
  const big = await seedBooking({
    nightlyPrices: [5_000_000, 1_000_001],
    paid: [{ amount: 3_000_000 }, { amount: 3_000_001 }],
  });
  const bigMove = await proposeWalkout(big, token);
  const bigTag = etagOf(await get(`${MOVES}/${bigMove.id}`, token));
  expect([200, 201]).toContain(
    (
      await executeWalkout(
        bigMove,
        token,
        { pinToken: await mintPin('desk', big.id) },
        { tag: bigTag },
      )
    ).status,
  );
  const bigRefund = (await refundRows(big.id))[0]!;
  const bigApproved = await post(`${REFUNDS}/${String(bigRefund.id)}/approve`, manager, {
    approvedAmount: 6_000_000,
    note: 'Duyệt hoàn walk-out vượt ngưỡng',
    pinToken: await mintPin('manager', big.id),
  });
  expect(bigApproved.status).toBe(200);
  const threshold = refundRequestSchema.parse(bigApproved.body);
  expect(threshold.requiresThresholdControl).toBe(true);
  const allocations = await rows(
    'SELECT amount::text AS amount FROM refund_allocations WHERE refund_request_id=$1',
    [bigRefund.id],
  );
  expect(allocations).toHaveLength(2);
  expect(allocations.reduce((sum, line) => sum + Number(line.amount), 0)).toBe(6_000_000);
});

test('HB124_replay_and_ambiguous_payout_no_double_spend', async () => {
  await setSetting('refund.feeAmount', '1000');
  const booking = await seedBooking({
    nightlyPrices: [2_000_000, 500_000, 500_000],
    assignRoomIds: [rooms.r1],
    // Nguồn VNPAY ⇒ leg chi tự động qua PSP mô phỏng; BANK_TRANSFER cố ý dừng chờ đối soát tay.
    paid: [{ amount: 5_001, method: 'VNPAY' }],
  });
  const token = await staffToken('desk');
  const move = await proposeWalkout(booking, token);
  const tag = etagOf(await get(`${MOVES}/${move.id}`, token));
  const key = randomUUID();
  const pin = await mintPin('desk', booking.id);
  const first = await executeWalkout(move, token, { pinToken: pin }, { tag, key });
  expect([200, 201]).toContain(first.status);
  const replay = await executeWalkout(move, token, { pinToken: pin }, { tag, key });
  expect(replay.status).toBe(first.status);
  expect(replay.body).toEqual(first.body);
  expect(await refundRows(booking.id)).toHaveLength(1);
  expect(await outboxFor(booking.id)).toHaveLength(1);
  const reused = await executeWalkout(
    move,
    token,
    { pinToken: pin, reason: 'payload khác' },
    { tag, key },
  );
  expect(reused.status).toBe(409);
  expect(errorCode(reused)).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');

  const refundId = String((await refundRows(booking.id))[0]!.id);
  const manager = await staffToken('manager');
  expect(
    (
      await post(`${REFUNDS}/${refundId}/approve`, manager, {
        approvedAmount: 4_000,
        note: 'Duyệt chi hoàn walk-out',
        pinToken: await mintPin('manager', booking.id),
      })
    ).status,
  ).toBe(200);
  const cashier = await staffToken('accountant');
  expect(
    (
      await post(`${REFUNDS}/${refundId}/pay`, cashier, {
        method: 'VNPAY',
        pinToken: await mintPin('accountant', booking.id),
      })
    ).status,
  ).toBe(202);
  const [before] = await operations(refundId);
  expect(before).toBeTruthy();

  const timeout: PayoutGateway = {
    automatic: true,
    query: async () => ({ state: 'NOT_FOUND' }),
    submit: async () => {
      throw new Error('synthetic HB124 gateway timeout');
    },
  };
  await runPayoutJob({ gateway: () => timeout });
  const [parked] = await operations(refundId);
  expect(parked).toMatchObject({
    status: 'UNKNOWN',
    last_error: 'PROVIDER_TIMEOUT',
    psp_key: before!.psp_key,
  });
  expect((await refundRows(booking.id))[0]!.status).toBe('APPROVED');
  expect(await simulatorTransfers()).toHaveLength(0);
  expect((await refundPayments(booking.id))[0]).toMatchObject({ status: 'PENDING' });

  await rows(
    "UPDATE refund_payout_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE refund_request_id=$1::uuid",
    [refundId],
  );
  await runPayoutJob();
  expect(await simulatorTransfers()).toHaveLength(1);
  const [settled] = await operations(refundId);
  expect(settled).toMatchObject({ status: 'SUCCEEDED', psp_key: before!.psp_key });
  expect((await refundRows(booking.id))[0]!.status).toBe('PAID');
  expect(await refundPayments(booking.id)).toHaveLength(1);
});

test('HB124_unassigned_walkout_removes_demand_atomically', async () => {
  await setSetting('refund.feeAmount', '1000');
  const manager = await staffToken('manager');
  const caseId = await seedCase({ shortage: 1, roomType: roomTypes.oversold });
  const booking = await seedBooking({
    roomType: roomTypes.oversold,
    nightlyPrices: [500_000],
    checkIn: day(D, 3),
    paid: [{ amount: 500_000 }],
  });
  const blocked = await post(RESOLVE(caseId), manager, { resolutionNote: 'Chưa xử lý' });
  guardRoute(blocked, 'POST /overbooking-cases/{id}/resolve');
  expect(blocked.status).toBe(409);

  const token = await staffToken('desk');
  const move = await proposeWalkout(booking, token, { overbookingCaseId: caseId });
  const tag = etagOf(await get(`${MOVES}/${move.id}`, token));
  expect([200, 201]).toContain(
    (await executeWalkout(move, token, { pinToken: await mintPin('desk', booking.id) }, { tag }))
      .status,
  );
  expect(await bookingRow(booking.id)).toMatchObject({
    status: 'CANCELLED',
    cancel_reason: 'HOTEL_RELOCATION',
    penalty_amount: '0',
  });
  const charges = await rows(
    "SELECT amount::text AS amount,voided_amount::text AS voided FROM booking_charges WHERE booking_id=$1 AND kind='ROOM'",
    [booking.id],
  );
  expect(charges.every((line) => line.voided === line.amount)).toBe(true);
  expect(await chargeTotal(booking.id)).toBe(0);
  expect(await countRows('SELECT id FROM refund_requests WHERE booking_id=$1', [booking.id])).toBe(
    1,
  );
  expect((await refundRows(booking.id))[0]).toMatchObject({ reason: 'HOTEL_RELOCATION' });
  expect(await outboxFor(booking.id)).not.toHaveLength(0);
  expect(
    await countRows(
      "SELECT id FROM booking_status_history WHERE booking_id=$1 AND to_status='CANCELLED'",
      [booking.id],
    ),
  ).toBeGreaterThan(0);

  const resolved = await post(RESOLVE(caseId), manager, {
    resolutionNote: 'Walk-out xong, thiếu phòng thực tế = 0',
  });
  expect([200, 201]).toContain(resolved.status);

  // Lỗi chèn outbox sau khi đã nhả nguồn phải rollback toàn bộ (booking/chứng từ/nghĩa vụ).
  const rollback = await seedBooking({ assignRoomIds: [rooms.r2], paid: [{ amount: 500_000 }] });
  const pending = await proposeWalkout(rollback, token);
  const pendingTag = etagOf(await get(`${MOVES}/${pending.id}`, token));
  const failed = await withFailingInsert('outbox_events', 'hb124_outbox_fail', async () =>
    executeWalkout(
      pending,
      token,
      { pinToken: await mintPin('desk', rollback.id) },
      { tag: pendingTag },
    ),
  );
  expect(failed.status).toBeGreaterThanOrEqual(500);
  expect((await bookingRow(rollback.id)).status).toBe('CONFIRMED');
  expect(await chargeTotal(rollback.id)).toBe(500_000);
  expect(await refundRows(rollback.id)).toHaveLength(0);
  expect(await completedKeys(`%/room-moves/${pending.id}/execute%`)).toHaveLength(0);
});
