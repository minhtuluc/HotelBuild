import { describe, expect, it } from 'vitest';
import {
  MAX_GRID_DAYS,
  addDays,
  businessDate,
  cellStatus,
  dayCount,
  defaultRange,
  gridDates,
  nextCellIndex,
  publishedAvailability,
} from '../src/lib/inventory-grid';

const CELL = { supply: 10, demand: 4, pool: 6, blocked: 0 };

describe('số liệu ô lưới tồn (BR-INV-01)', () => {
  it('tồn công bố là max(0, pool), pool nội bộ được âm', () => {
    expect(publishedAvailability(CELL)).toBe(6);
    expect(publishedAvailability({ ...CELL, pool: -3 })).toBe(0);
    expect(publishedAvailability({ ...CELL, pool: 0 })).toBe(0);
  });

  it('trạng thái ô suy thẳng từ pool và blocked', () => {
    expect(cellStatus({ ...CELL, pool: 3 })).toBe('available');
    expect(cellStatus({ ...CELL, pool: 0, blocked: 0 })).toBe('held');
    expect(cellStatus({ ...CELL, pool: 0, blocked: 2 })).toBe('blocked');
    expect(cellStatus({ ...CELL, pool: -1 })).toBe('oversold');
  });

  it('trần khoảng lưới là 31 ngày', () => {
    expect(MAX_GRID_DAYS).toBe(31);
  });
});

describe('khoảng ngày của lưới', () => {
  it('ngày nghiệp vụ tính theo giờ VN', () => {
    expect(businessDate(new Date('2026-10-02T17:30:00.000Z'))).toBe('2026-10-03');
    expect(businessDate(new Date('2026-10-02T16:59:00.000Z'))).toBe('2026-10-02');
  });

  it('khoảng mặc định là 7 ngày kể từ hôm nay (đồng hồ tiêm được)', () => {
    expect(defaultRange(new Date('2026-10-02T03:00:00.000Z'))).toEqual({
      from: '2026-10-02',
      to: '2026-10-08',
    });
  });

  it('liệt kê đủ ngày, tính cả hai đầu, và rỗng khi khoảng sai', () => {
    expect(gridDates('2026-10-01', '2026-10-03')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(gridDates('2026-10-03', '2026-10-01')).toEqual([]);
    expect(dayCount('2026-10-01', '2026-10-31')).toBe(31);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('điều hướng bàn phím trên lưới', () => {
  const rows = 3;
  const cols = 4;

  it('giữ trong biên, không tràn hàng', () => {
    expect(nextCellIndex({ row: 0, col: 3 }, 'ArrowRight', rows, cols)).toEqual({ row: 0, col: 3 });
    expect(nextCellIndex({ row: 0, col: 0 }, 'ArrowLeft', rows, cols)).toEqual({ row: 0, col: 0 });
    expect(nextCellIndex({ row: 2, col: 1 }, 'ArrowDown', rows, cols)).toEqual({ row: 2, col: 1 });
    expect(nextCellIndex({ row: 0, col: 1 }, 'ArrowUp', rows, cols)).toEqual({ row: 0, col: 1 });
  });

  it('đi theo hàng, cột và về đầu/cuối hàng bằng Home/End', () => {
    expect(nextCellIndex({ row: 1, col: 1 }, 'ArrowRight', rows, cols)).toEqual({ row: 1, col: 2 });
    expect(nextCellIndex({ row: 1, col: 1 }, 'ArrowDown', rows, cols)).toEqual({ row: 2, col: 1 });
    expect(nextCellIndex({ row: 1, col: 2 }, 'Home', rows, cols)).toEqual({ row: 1, col: 0 });
    expect(nextCellIndex({ row: 1, col: 2 }, 'End', rows, cols)).toEqual({ row: 1, col: 3 });
  });

  it('lưới rỗng trả về ô gốc', () => {
    expect(nextCellIndex({ row: 5, col: 5 }, 'ArrowRight', 0, 0)).toEqual({ row: 0, col: 0 });
  });
});
it('rejects rolled calendar dates and bounds allocation to31days', () => {
  expect(gridDates('2026-02-30', '2026-03-02')).toEqual([]);
  expect(gridDates('0001-01-01', '9999-12-31')).toEqual([]);
  expect(gridDates('2026-11-01', '2026-12-02')).toEqual([]);
});
