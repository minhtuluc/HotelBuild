/** HB-061: phần thuần SCR-29 — kiểm đủ trường, đổi đơn vị theo `type`, thân lệnh tạo mã. */
import { describe, expect, it } from 'vitest';
import type { PromotionSummary } from '@pinehill/contracts';
import {
  CHANNEL_CODES,
  EMPTY_PROMOTION_DRAFT,
  toCreateRequest,
  toggle,
  usageText,
  validateDraft,
  valueIssue,
  valueUnitKey,
  type PromotionDraft,
} from '../src/lib/promotions';

const draft = (over: Partial<PromotionDraft> = {}): PromotionDraft => ({
  ...EMPTY_PROMOTION_DRAFT,
  code: 'EARLY10',
  value: '10',
  minNights: '2',
  validFrom: '2026-11-01T00:00',
  validTo: '2026-11-30T23:59',
  channelScope: ['WEB'],
  roomTypeScope: ['rt1'],
  ...over,
});

describe('valueIssue / valueUnitKey', () => {
  it('phần trăm 1–100, tiền VND nguyên dương', () => {
    expect(valueIssue('PERCENT', '100')).toBeNull();
    expect(valueIssue('PERCENT', '101')).toEqual({ field: 'value', issue: 'OUT_OF_RANGE' });
    expect(valueIssue('PERCENT', '0')).toEqual({ field: 'value', issue: 'OUT_OF_RANGE' });
    expect(valueIssue('AMOUNT', '250000')).toBeNull();
    expect(valueIssue('AMOUNT', '1,5')).toEqual({ field: 'value', issue: 'NOT_INTEGER' });
  });

  it('đơn vị đổi theo loại giảm', () => {
    expect(valueUnitKey('PERCENT')).toBe('promotions.value.percent');
    expect(valueUnitKey('AMOUNT')).toBe('promotions.value.amount');
  });

  it('AMOUNT cho phép giá trị lớn hơn 100 (không áp trần phần trăm)', () => {
    expect(valueIssue('AMOUNT', '500000')).toBeNull();
  });
});

describe('validateDraft', () => {
  it('bản nhập hợp lệ không có lỗi', () => {
    expect(validateDraft(draft())).toEqual([]);
  });

  it('chặn mã sai mẫu, thiếu phạm vi và ngày ngược', () => {
    expect(validateDraft(draft({ code: 'ab' }))).toEqual([{ field: 'code', issue: 'PATTERN' }]);
    expect(validateDraft(draft({ channelScope: [] }))).toEqual([
      { field: 'channelScope', issue: 'REQUIRED' },
    ]);
    expect(validateDraft(draft({ roomTypeScope: [] }))).toEqual([
      { field: 'roomTypeScope', issue: 'REQUIRED' },
    ]);
    expect(validateDraft(draft({ validTo: '2026-10-01T00:00' }))).toEqual([
      { field: 'validTo', issue: 'BEFORE_START' },
    ]);
  });

  it('chặn thiếu đêm tối thiểu và lượt tối đa sai', () => {
    expect(validateDraft(draft({ minNights: '0' }))).toEqual([
      { field: 'minNights', issue: 'OUT_OF_RANGE' },
    ]);
    expect(validateDraft(draft({ maxUses: '0' }))).toEqual([
      { field: 'maxUses', issue: 'OUT_OF_RANGE' },
    ]);
    expect(validateDraft(draft({ maxUses: '' }))).toEqual([]);
  });
});

describe('toCreateRequest', () => {
  it('viết hoa mã, đổi ngày sang ISO UTC, bỏ maxUses khi trống', () => {
    const request = toCreateRequest(draft({ code: 'early10' }));
    expect(request.code).toBe('EARLY10');
    expect(request.value).toBe(10);
    expect(request.validFrom).toBe(new Date('2026-11-01T00:00').toISOString());
    expect('maxUses' in request).toBe(false);
    expect(request.stackable).toBe(false);
  });

  it('kèm maxUses khi có', () => {
    expect(toCreateRequest(draft({ maxUses: '100' })).maxUses).toBe(100);
  });
});

describe('toggle / usageText', () => {
  it('bật/tắt giữ thứ tự chọn', () => {
    expect(toggle([], 'WEB')).toEqual(['WEB']);
    expect(toggle(['WEB', 'PHONE'], 'WEB')).toEqual(['PHONE']);
  });

  it('có 7 kênh canonical và lượt dùng không giới hạn hiện ∞', () => {
    expect(CHANNEL_CODES).toHaveLength(7);
    const row: PromotionSummary = {
      id: 'pr1',
      code: 'EARLY10',
      type: 'PERCENT',
      value: 10,
      minNights: 2,
      channelScope: ['WEB'],
      roomTypeScope: ['rt1'],
      validFrom: '2026-11-01T00:00:00.000Z',
      validTo: '2026-11-30T16:59:00.000Z',
      maxUses: null,
      usedCount: 3,
      stackable: false,
      status: 'ACTIVE',
      version: 1,
    };
    expect(usageText(row)).toBe('3/∞');
    expect(usageText({ ...row, maxUses: 10 })).toBe('3/10');
  });
});
