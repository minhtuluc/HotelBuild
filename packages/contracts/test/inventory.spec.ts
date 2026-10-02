import { describe, expect, it } from 'vitest';
import { inventoryGridQuerySchema } from '../src/inventory.js';

const query = (from: string, to: string) => ({ propertyId: 'CS-01', from, to });

describe('inventoryGridQuerySchema (HB-030 AC3)', () => {
  it('nhận khoảng 0 và đúng 31 ngày, kể cả vắt tháng/năm', () => {
    expect(inventoryGridQuerySchema.safeParse(query('2026-10-01', '2026-10-01')).success).toBe(
      true,
    );
    expect(inventoryGridQuerySchema.safeParse(query('2026-12-15', '2027-01-15')).success).toBe(
      true,
    );
  });

  it('từ chối 32 ngày và `to` trước `from`', () => {
    const tooLong = inventoryGridQuerySchema.safeParse(query('2026-10-01', '2026-11-02'));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.path).toEqual(['to']);
    expect(inventoryGridQuerySchema.safeParse(query('2026-10-02', '2026-10-01')).success).toBe(
      false,
    );
  });
});
