/**
 * HB-230 (TD-80, QA HB-194 QA-F6-05) — `RoomMove` lưu `overbookingCaseId` và `consent` (migration 0011).
 * Trước đây máy chủ nhận hai trường rồi trả `null`, nên không nối được lệnh điều chuyển với ca quá tải
 * và bằng chứng đồng ý của khách (BR-OVER-06) chỉ nằm trong `reason`.
 */
import { roomMoveSchema } from '@pinehill/contracts';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorCode, get, post, staffToken } from './helpers/harness.js';
import { MOVES, moveBody, proposeMove } from './helpers/actions.js';
import { moveRow, otherPropertyId, rooms, seedBooking, seedCase } from './helpers/seed.js';

test('HB230_move_keeps_case_and_client_consent_in_db_and_view', async () => {
  const token = await staffToken('desk');
  const booking = await seedBooking({ assignRoomIds: [rooms.r1] });
  const caseId = await seedCase();
  const consent = { granted: true, channel: 'PHONE', evidenceRef: 'call:hb230' } as const;
  const move = await proposeMove(
    token,
    moveBody(booking.id, booking.bookingRoomIds[0]!, rooms.r2, {
      overbookingCaseId: caseId,
      consent,
    }),
  );
  const row = await moveRow(move.id);
  expect(row.overbooking_case_id).toBe(caseId);
  expect(row.consent_json).toMatchObject(consent);
  expect(z.object({ recordedAt: z.string().datetime() }).safeParse(row.consent_json).success).toBe(
    true,
  );

  const read = await get(`${MOVES}/${move.id}`, token);
  expect(read.status).toBe(200);
  const view = roomMoveSchema.parse(read.body);
  expect(view.overbookingCaseId).toBe(caseId);
  expect(view.consent).toMatchObject(consent);
});

test('HB230_missing_consent_is_not_stored_as_server_default', async () => {
  const token = await staffToken('desk');
  const booking = await seedBooking({ assignRoomIds: [rooms.r1] });
  const move = await proposeMove(token, moveBody(booking.id, booking.bookingRoomIds[0]!, rooms.r2));
  const row = await moveRow(move.id);
  expect(row.overbooking_case_id).toBeNull();
  // Máy chủ chỉ điền mặc định để đối chiếu hợp đồng; không lưu như thể khách đã đồng ý.
  expect(row.consent_json).toBeNull();
  const view = roomMoveSchema.parse((await get(`${MOVES}/${move.id}`, token)).body);
  expect(view.consent).toBeNull();
});

test('HB230_case_of_another_property_is_rejected', async () => {
  const token = await staffToken('manager');
  const booking = await seedBooking({ assignRoomIds: [rooms.r1] });
  const foreignCase = await seedCase({ property: otherPropertyId });
  const response = await post(
    MOVES,
    token,
    moveBody(booking.id, booking.bookingRoomIds[0]!, rooms.r2, { overbookingCaseId: foreignCase }),
  );
  expect([400, 403]).toContain(response.status);
  expect(['E_GEN_VALIDATION_FAILED', 'E_AUTH_OUT_OF_SCOPE']).toContain(errorCode(response));
});
