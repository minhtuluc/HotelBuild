import { describe, expect, it } from 'vitest';
import { inventoryGridQuerySchema, inventoryGridSchema } from '../src/inventory.js';

const query = (from: string, to: string) => ({ propertyId: 'CS-01', from, to });

describe('inventoryGridQuerySchema (HB-030 AC3)', () => {
  it('nhận khoảng 0 và đúng 31 ngày, kể cả vắt tháng/năm', () => {
    expect(inventoryGridQuerySchema.safeParse(query('2026-10-01', '2026-10-01')).success).toBe(
      true,
    );
    expect(inventoryGridQuerySchema.safeParse(query('2026-12-15', '2027-01-14')).success).toBe(
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

// API §1.5 includes both ends: difference31 means32 dates, not31.
it('rejects32 inclusive dates across year boundary', () => {
  expect(inventoryGridQuerySchema.safeParse(query('2026-12-15', '2027-01-15')).success).toBe(false);
});
it('preserves additive published/channel data and nonrecursive multi-type grids', () => {
  const cell = {
    date: '2026-11-01',
    supply: 3,
    demand: 1,
    pool: 2,
    blocked: 0,
    published: 2,
    channelAvailable: 1,
  };
  const primary = {
    propertyId: 'p1',
    roomTypeId: 'rt1',
    from: cell.date,
    to: cell.date,
    cells: [cell],
  };
  const response = { ...primary, grids: [primary, { ...primary, roomTypeId: 'rt2' }] };
  expect(inventoryGridSchema.parse(response)).toEqual(response);
});
