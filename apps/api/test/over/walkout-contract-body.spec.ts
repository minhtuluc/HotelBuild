/**
 * HB-222 — walk-out gửi đúng hợp đồng công bố (`roomMoveCreateRequestSchema`: chứng từ trong `walkOut`
 * lồng nhau, như SCR-44 ops-web gửi) phải giữ biên bản/chữ ký và thực thi được. QA HB-194 (QA-F6-06):
 * server chỉ đọc trường phẳng của harness HB-124 nên bỏ êm `walkOut`, execute luôn 409. Dạng phẳng vẫn
 * được nhận (test khoá HB-124); body có cả hai dạng mâu thuẫn bị 400.
 */
import { expect, test } from 'vitest';
import { walkOutEvidenceSchema } from '@pinehill/contracts';
import { z } from 'zod';
import { errorCode, etagOf, get, mintPin, post, staffToken } from './helpers/harness.js';
import { moveRow, rooms, seedBooking } from './helpers/seed.js';
import { moveViewSchema } from './helpers/views.js';

const MOVES = '/api/v1/room-moves';

const contractBody = (booking: {
  id: string;
  bookingRoomIds: readonly string[];
  nightlyPrices: readonly number[];
}) => ({
  bookingId: booking.id,
  bookingRoomId: booking.bookingRoomIds[0],
  moveType: 'WALK_OUT',
  reason: 'Hết phòng phù hợp — walk-out theo hợp đồng công bố',
  compensationAmount: booking.nightlyPrices[0] ?? 0,
  transportCost: 0,
  consent: { granted: true, channel: 'IN_PERSON' },
  walkOut: {
    walkOutDocNo: 'BB-222-CONTRACT',
    guestSignatureRef: 'esign:guest:hb222',
    staffSignatureRef: 'esign:staff:hb222',
    refundRequestId: null,
    compensationPaymentId: null,
  },
});

test('HB222_contract_walkout_body_keeps_documents_and_executes', async () => {
  const booking = await seedBooking({
    nightlyPrices: [900_000],
    assignRoomIds: [rooms.r1],
    paid: [{ amount: 900_000, method: 'CASH' }],
  });
  const desk = await staffToken('desk');
  const created = await post(MOVES, desk, contractBody(booking));
  expect(created.status).toBe(201);
  const view = moveViewSchema.parse(created.body);
  const evidence = z.object({ walkOut: walkOutEvidenceSchema }).parse(created.body).walkOut;
  expect(evidence).toMatchObject({
    walkOutDocNo: 'BB-222-CONTRACT',
    guestSignatureRef: 'esign:guest:hb222',
    staffSignatureRef: 'esign:staff:hb222',
  });
  expect(await moveRow(view.id)).toMatchObject({ walk_out_doc_no: 'BB-222-CONTRACT' });

  const approved = await post(`${MOVES}/${view.id}/approve`, await staffToken('manager'), {
    compensationAmount: view.compensationAmount,
    transportCost: 0,
    pinToken: await mintPin('manager', booking.id),
  });
  expect([200, 201]).toContain(approved.status);
  const tag = etagOf(await get(`${MOVES}/${view.id}`, desk));
  const executed = await post(
    `${MOVES}/${view.id}/execute`,
    desk,
    { pinToken: await mintPin('desk', booking.id) },
    { tag },
  );
  expect(executed.status).toBe(200);
  expect(moveViewSchema.parse(executed.body).status).toBe('EXECUTED');
});

test('HB222_conflicting_flat_and_nested_documents_rejected', async () => {
  const booking = await seedBooking({ nightlyPrices: [900_000], assignRoomIds: [rooms.r1] });
  const desk = await staffToken('desk');
  const conflicted = await post(MOVES, desk, {
    ...contractBody(booking),
    walkOutDocNo: 'BB-222-OTHER',
    guestSignatureRef: 'esign:guest:hb222',
    staffSignatureRef: 'esign:staff:hb222',
  });
  expect(conflicted.status).toBe(400);
  expect(errorCode(conflicted)).toBe('E_GEN_VALIDATION_FAILED');
});
