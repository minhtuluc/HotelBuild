/**
 * HB-251 — lý do từ chối nhận phòng có mã cho máy đọc. Câu chữ `message` không đủ để app biết nên đề nghị
 * "ghi biên bản đã kiểm phòng" (BR-FO-07) hay việc khác; `details` mang mã lý do an toàn (không PII).
 */
import { expect, test } from 'vitest';
import { errorBodySchema } from '@pinehill/contracts';
import { CHECK_IN, checkInBody, post, roomA, seedBooking, staffToken } from './fixture.js';

test('phòng chưa có bằng chứng sẵn sàng: 409 kèm details reason=UNITS_NOT_READY', async () => {
  const token = await staffToken('FRONT_DESK');
  const seed = await seedBooking({ paidInFull: true });
  const refused = await post(CHECK_IN, token, checkInBody(seed, roomA()));
  expect(refused.status).toBe(409);
  const body = errorBodySchema.parse(refused.body);
  expect(body.code).toBe('E_FO_CHECKIN_NOT_ALLOWED');
  expect(body.details).toEqual([{ field: 'reason', issue: 'UNITS_NOT_READY' }]);
});
