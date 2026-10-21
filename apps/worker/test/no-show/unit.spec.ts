import { describe, expect, it } from 'vitest';
import { firstNightPenalty, paidShare } from '../../src/jobs/no-show/mark.js';

/**
 * HB-147 — pin hai mẩu công thức mà worker phải giữ khớp với nguồn chân lý
 * (`packages/domain/src/cancellation`: `allocatePayment` + bậc bắt tất của chính sách).
 * Worker không import được `@pinehill/domain`, nên test này là hàng rào chống lệch âm thầm.
 */
describe('HB-147 — công thức phạt đêm đầu', () => {
  it('BR-CANCEL-06: phạt = max(0, giá đêm đầu − đã thu)', () => {
    expect(firstNightPenalty(1_100_000n, 300_000n)).toBe(800_000n);
    expect(firstNightPenalty(1_100_000n, 1_100_000n)).toBe(0n);
    expect(firstNightPenalty(1_100_000n, 2_000_000n)).toBe(0n);
    expect(firstNightPenalty(0n, 0n)).toBe(0n);
  });

  it('chia tiền đã thu theo trọng số phòng, phần dư cho phòng id nhỏ trước', () => {
    const rooms = [
      { bookingRoomId: 'a', weight: 1_000_000n },
      { bookingRoomId: 'b', weight: 3_000_000n },
    ];
    // 1.000.000 chia đúng tỷ lệ 1:3 ⇒ 250.000 / 750.000.
    expect(paidShare(rooms, [1_000_000n], new Set(['a', 'b']))).toBe(1_000_000n);
    // Lẻ 1 đồng: floor(250.000,25)=250.000 và floor(750.000,75)=750.000 ⇒ dư 1 cho 'a'.
    const both = paidShare(rooms, [1_000_001n], new Set(['a', 'b']));
    expect(both).toBe(1_000_001n);
    expect(paidShare(rooms, [1_000_001n], new Set(['a']))).toBe(250_001n);
    expect(paidShare(rooms, [1_000_001n], new Set(['b']))).toBe(750_000n);
  });

  it('chỉ chọn một phần phòng thì chỉ cộng phần của các phòng đó', () => {
    const rooms = [
      { bookingRoomId: 'a', weight: 2_200_000n },
      { bookingRoomId: 'b', weight: 2_200_000n },
    ];
    expect(paidShare(rooms, [500_000n], new Set(['b']))).toBe(250_000n);
    expect(paidShare(rooms, [], new Set(['a', 'b']))).toBe(0n);
    // Không có trọng số ⇒ không có cơ sở phân bổ, trả 0 thay vì chia cho 0.
    expect(paidShare([], [500_000n], new Set())).toBe(0n);
  });
});
