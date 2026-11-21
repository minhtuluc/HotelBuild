/**
 * HB-268 — lệnh đổi phòng không bắt buộc `bookingRoomId` khi booking chỉ có **một** phòng đang hoạt động.
 *
 * Máy thật: lễ tân mở ca quá tải → "Xử lý" → chọn nâng hạng → "Lập điều chuyển" ⇒ app ném ZodError vì
 * `bookingRoomId` rỗng. Bản cảnh báo của lễ tân (HB-221) không mang phòng của booking, chi tiết ca có phòng
 * nhưng chỉ MANAGER/OWNER đọc được — nên lễ tân không bao giờ lập được điều chuyển. Máy chủ suy ra phòng khi
 * chỉ có một; booking nhiều phòng vẫn phải chỉ rõ phòng nào.
 */
import { expect, test } from 'vitest';
import { errorCode, post, staffToken } from './helpers/harness.js';
import { MOVES, moveBody, proposeMove } from './helpers/actions.js';
import { moveRow, rooms, seedBooking, seedCase } from './helpers/seed.js';

const withoutRoom = (body: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'bookingRoomId'));

test('booking một phòng: bỏ bookingRoomId thì máy chủ tự lấy đúng phòng đang hoạt động', async () => {
  const seeded = await seedBooking({ assignRoomIds: [rooms.r1] });
  const caseId = await seedCase({ shortage: 1 });
  const token = await staffToken('desk');
  const proposal = await proposeMove(
    token,
    withoutRoom(
      moveBody(seeded.id, seeded.bookingRoomIds[0]!, rooms.r2, { overbookingCaseId: caseId }),
    ),
  );
  expect(proposal.status).toBe('PROPOSED');
  expect((await moveRow(proposal.id)).booking_room_id).toBe(seeded.bookingRoomIds[0]);
});

test('booking nhiều phòng: bỏ bookingRoomId ⇒ 400, phải chỉ rõ phòng', async () => {
  const seeded = await seedBooking({ spaces: 2 });
  const token = await staffToken('desk');
  const refused = await post(
    MOVES,
    token,
    withoutRoom(moveBody(seeded.id, seeded.bookingRoomIds[0]!, rooms.r2)),
  );
  expect(refused.status).toBe(400);
  expect(errorCode(refused)).toBe('E_GEN_VALIDATION_FAILED');
});
