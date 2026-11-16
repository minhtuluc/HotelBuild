import { describe, expect, it } from 'vitest';
import { railPosition } from '../../src/components/content/scroll-rails';

/** HB-327 — đầu tàu trên đường ray hai lề trang chủ nội suy theo vạch đọc. */

describe('railPosition', () => {
  const tops = [100, 300, 700];

  it('chưa tới ga đầu: đứng chờ ở ga đầu, chưa khởi hành', () => {
    expect(railPosition(tops, 50)).toEqual({ pos: 0, started: false });
  });

  it('đúng lúc đỉnh dải chạm vạch đọc thì đầu tàu ở đúng ga đó', () => {
    expect(railPosition(tops, 100)).toEqual({ pos: 0, started: true });
    expect(railPosition(tops, 300)).toEqual({ pos: 1, started: true });
  });

  it('giữa hai dải thì nội suy theo tỉ lệ quãng đã đọc', () => {
    expect(railPosition(tops, 200).pos).toBeCloseTo(0.5);
    expect(railPosition(tops, 400).pos).toBeCloseTo(1.25);
  });

  it('qua ga cuối thì kẹp ở ga cuối', () => {
    expect(railPosition(tops, 5000)).toEqual({ pos: 2, started: true });
  });

  it('không có dải hoặc hai dải trùng đỉnh vẫn ra số hữu hạn', () => {
    expect(railPosition([], 100)).toEqual({ pos: 0, started: false });
    expect(railPosition([100, 100, 400], 100).pos).toBe(1);
  });
});
