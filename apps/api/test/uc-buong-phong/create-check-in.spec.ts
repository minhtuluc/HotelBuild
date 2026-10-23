/**
 * HB-207 AC5 — đầu-cuối: phòng chưa từng có nhiệm vụ không giao được (F7-QA-01); sau khi lễ tân ghi nhận
 * kiểm phòng qua `POST /housekeeping/tasks` thì check-in cùng ngày thành công (BR-FO-07).
 */
import { expect, test } from 'vitest';
import { checkInResponseSchema, housekeepingTaskSchema } from '@pinehill/contracts';
import {
  CHECK_IN,
  D,
  bookingRow,
  checkInBody,
  errorCode,
  post,
  roomA,
  seedBooking,
  staffToken,
} from '../uc-check-in/fixture.js';

test('phòng mới chưa có nhiệm vụ: 409 UNITS_NOT_READY ⇒ ghi nhận INSPECTED ⇒ check-in thành công', async () => {
  const token = await staffToken('FRONT_DESK');
  const seed = await seedBooking({ paidInFull: true });

  const refused = await post(CHECK_IN, token, checkInBody(seed, roomA()));
  expect(refused.status).toBe(409);
  expect(errorCode(refused)).toBe('E_FO_CHECKIN_NOT_ALLOWED');
  expect((await bookingRow(seed.id)).status).toBe('CONFIRMED');

  const inspected = await post('/api/v1/housekeeping/tasks', token, {
    roomId: roomA(),
    businessDate: D,
    status: 'INSPECTED',
    reason: 'Kiểm phòng trước lần giao đầu tiên',
  });
  expect(inspected.status, JSON.stringify(inspected.body)).toBe(201);
  expect(housekeepingTaskSchema.parse(inspected.body)).toMatchObject({
    roomId: roomA(),
    businessDate: D,
    status: 'INSPECTED',
  });

  const accepted = await post(CHECK_IN, token, checkInBody(seed, roomA()));
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  expect(checkInResponseSchema.parse(accepted.body)).toMatchObject({ status: 'CHECKED_IN' });
  expect((await bookingRow(seed.id)).status).toBe('CHECKED_IN');
});
