import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
import { createBody } from '../../src/features/f6-overbooking/model';

// HB-268: máy thật — lễ tân mở ca từ cảnh báo (không có phòng của booking) rồi "Lập điều chuyển" ⇒ ZodError
// vì `bookingRoomId: ''`. Không có phòng thì bỏ trường; máy chủ dùng phòng hoạt động duy nhất của booking.
const option = {
  moveType: 'UPGRADE_SAME_PROPERTY' as const,
  feasible: true,
  targetPropertyId: null,
  targetRoomId: 'room-sup-1',
  targetRoomTypeId: 'rt-sup',
  priceLocked: true as const,
  compensationAmount: 0,
  transportCost: 0,
};
const draft = { reason: 'Phòng STD bảo trì đột xuất', granted: true };

describe('thân lệnh lập điều chuyển (HB-268)', () => {
  it('không có phòng của booking thì không gửi bookingRoomId (không ném lỗi)', () => {
    const body = createBody({ caseId: 'c1', bookingId: 'b1', bookingRoomId: '' }, option, draft);
    expect(body).not.toHaveProperty('bookingRoomId');
    expect(body).toMatchObject({ bookingId: 'b1', toRoomId: 'room-sup-1' });
  });

  it('có phòng thì gửi đúng phòng đó', () => {
    const body = createBody(
      { caseId: 'c1', bookingId: 'b1', bookingRoomId: 'br-1' },
      option,
      draft,
    );
    expect(body.bookingRoomId).toBe('br-1');
  });
});
