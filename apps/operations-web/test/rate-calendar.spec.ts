import { describe, expect, it } from 'vitest';
import {
  buildOverrideBody,
  isLargeChange,
  planOverrides,
  priceWarning,
  validateSubmit,
  type RateEdit,
} from '../src/lib/rate-calendar';
import { toMoney } from '../src/lib/money';

const edit = (date: string, currentPrice: number, nextPrice: number): RateEdit => ({
  date,
  currentPrice,
  nextPrice,
});

describe('lệch giá so với giá hiện hành của chính ngày đó (BR-RBAC-04)', () => {
  it('đúng ±20% chưa cần xác nhận, vượt mới cần', () => {
    expect(isLargeChange(1_000_000, 1_200_000)).toBe(false);
    expect(isLargeChange(1_000_000, 1_200_001)).toBe(true);
    expect(isLargeChange(1_000_000, 800_000)).toBe(false);
    expect(isLargeChange(1_000_000, 799_999)).toBe(true);
  });
});

describe('cảnh báo ngoài sàn–trần (BR-RATE-03/04)', () => {
  it('nhận đúng biên và vùng ngoài', () => {
    expect(priceWarning(699_999, 700_000, 1_400_000)).toBe('belowFloor');
    expect(priceWarning(1_400_001, 700_000, 1_400_000)).toBe('aboveCeiling');
    expect(priceWarning(700_000, 700_000, 1_400_000)).toBeNull();
    expect(priceWarning(1_400_000, 700_000, 1_400_000)).toBeNull();
  });
});

describe('gộp bản nhập thành lệnh ghi đè', () => {
  it('ngày cùng giá đi một lệnh, giá khác đi lệnh riêng, ngày không đổi bị bỏ', () => {
    const plan = planOverrides([
      edit('2026-12-24', 900_000, 1_000_000),
      edit('2026-12-25', 900_000, 1_000_000),
      edit('2026-12-26', 900_000, 1_100_000),
      edit('2026-12-27', 900_000, 900_000),
    ]);
    expect(plan.orders).toEqual([
      { price: 1_000_000, dates: ['2026-12-24', '2026-12-25'], largeChange: false },
      { price: 1_100_000, dates: ['2026-12-26'], largeChange: true },
    ]);
    expect(plan.edited).toHaveLength(3);
    expect(plan.largeChange).toBe(true);
  });

  it('không sửa ngày nào thì không có lệnh nào', () => {
    const plan = planOverrides([edit('2026-12-24', 900_000, 900_000)]);
    expect(plan.orders).toEqual([]);
    expect(plan.largeChange).toBe(false);
  });
});

describe('kiểm trước khi gửi', () => {
  const base = {
    edits: [edit('2026-12-24', 900_000, 1_000_000)],
    reason: 'Khách đoàn',
    confirmLarge: false,
    priority: '0',
  };

  it('đủ điều kiện thì cho gửi', () => {
    expect(validateSubmit(base)).toEqual({ ok: true, details: [] });
  });

  it('thiếu lý do, thiếu ưu tiên hoặc không đổi giá thì chặn tại chỗ', () => {
    expect(validateSubmit({ ...base, reason: '  ' }).details).toEqual([
      { field: 'reason', issue: 'REQUIRED' },
    ]);
    expect(validateSubmit({ ...base, priority: '-1' }).details).toEqual([
      { field: 'priority', issue: 'INVALID' },
    ]);
    expect(
      validateSubmit({ ...base, edits: [edit('2026-12-24', 900_000, 900_000)] }).details,
    ).toEqual([{ field: 'price', issue: 'NO_CHANGE' }]);
  });

  it('lệch quá ±20% mà chưa tick xác nhận thì chặn, ngày lệch được nêu đích danh', () => {
    expect(
      validateSubmit({ ...base, edits: [edit('2026-12-24', 900_000, 1_200_000)] }).details,
    ).toEqual([{ field: '2026-12-24', issue: 'LARGE_CHANGE_UNCONFIRMED' }]);
    expect(
      validateSubmit({
        ...base,
        edits: [edit('2026-12-24', 900_000, 1_200_000)],
        confirmLarge: true,
      }),
    ).toEqual({ ok: true, details: [] });
  });

  it('giá ngoài sàn–trần chỉ được nhắc, không chặn gửi', () => {
    // `validateSubmit` không nhận sàn–trần: dưới sàn và trên trần vẫn gửi, máy chủ mới là nơi chặn.
    expect(validateSubmit({ ...base, edits: [edit('2026-12-24', 700_000, 699_999)] })).toEqual({
      ok: true,
      details: [],
    });
    expect(validateSubmit({ ...base, edits: [edit('2026-12-24', 1_400_000, 1_400_001)] })).toEqual({
      ok: true,
      details: [],
    });
  });
});

describe('thân lệnh gửi máy chủ', () => {
  it('lệch nhỏ thì bỏ hẳn trường xác nhận', () => {
    const plan = planOverrides([edit('2026-12-24', 900_000, 1_000_000)]);
    const order = plan.orders[0];
    expect(order).toBeDefined();
    expect(
      buildOverrideBody(order!, { priority: 0, reason: 'Khách đoàn', confirmLarge: true }),
    ).toEqual({
      items: [{ date: '2026-12-24', price: 1_000_000 }],
      priority: 0,
      reason: 'Khách đoàn',
    });
  });

  it('lệch lớn và đã tick thì đặt confirmOwnerOverride', () => {
    const order = planOverrides([edit('2026-12-24', 900_000, 1_200_000)]).orders[0];
    expect(order).toBeDefined();
    expect(
      buildOverrideBody(order!, { priority: 2, reason: 'Cao điểm', confirmLarge: true }),
    ).toEqual({
      items: [{ date: '2026-12-24', price: 1_200_000 }],
      priority: 2,
      reason: 'Cao điểm',
      confirmOwnerOverride: true,
    });
  });
});

describe('tiền nhập tay', () => {
  it('chỉ nhận số nguyên dương (BR-GEN-01)', () => {
    expect(toMoney(' 1000000 ')).toBe(1_000_000);
    expect(toMoney('1000.5')).toBeNull();
    expect(toMoney('-1')).toBeNull();
    expect(toMoney('0')).toBeNull();
    expect(toMoney('abc')).toBeNull();
  });
});
