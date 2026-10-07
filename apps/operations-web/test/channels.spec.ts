/** HB-060: phần thuần SCR-28 — ngưỡng sàn, cảnh báo kênh, trường đã đổi, dòng ghi đè mới. */
import { describe, expect, it } from 'vitest';
import type { ChannelSummary } from '@pinehill/contracts';
import {
  channelWarnings,
  changedFields,
  draftOf,
  floorMultiplier,
  ifMatchOf,
  overrideUpdateRequest,
  validateDraft,
  validateOverride,
  EMPTY_OVERRIDE_DRAFT,
} from '../src/lib/channels';

const channel = (over: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id: 'c1',
  code: 'OTA_BOOKING',
  name: 'Booking.com',
  multiplier: 1,
  commissionPct: 18,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 4,
  ...over,
});

describe('floorMultiplier', () => {
  it('tính 1/(1−hoa hồng) và trả null khi hoa hồng ≥ 100%', () => {
    expect(floorMultiplier(0)).toBe(1);
    expect(floorMultiplier(18)).toBeCloseTo(1 / 0.82, 10);
    expect(floorMultiplier(50)).toBe(2);
    expect(floorMultiplier(100)).toBeNull();
  });
});

describe('channelWarnings', () => {
  it('cảnh báo khi hệ số thấp hơn sàn', () => {
    expect(channelWarnings({ code: 'OTA_BOOKING', multiplier: 1.1, commissionPct: 18 })).toEqual([
      'belowFloor',
    ]);
    expect(channelWarnings({ code: 'OTA_BOOKING', multiplier: 1.25, commissionPct: 18 })).toEqual(
      [],
    );
  });

  it('AGENCY được miễn quy tắc sàn', () => {
    expect(channelWarnings({ code: 'AGENCY', multiplier: 0.5, commissionPct: 40 })).toEqual([]);
  });

  it('kênh trực tiếp dưới 1,00 sinh cảnh báo BR-RATE-09', () => {
    expect(channelWarnings({ code: 'WEB', multiplier: 0.95, commissionPct: 0 })).toEqual([
      'directBelowOne',
    ]);
    // Kênh trực tiếp 0% hoa hồng KHÔNG có ngưỡng sàn (BR-RATE-07: sàn chỉ cho kênh hoa hồng > 0).
    expect(channelWarnings({ code: 'PHONE', multiplier: 0.5, commissionPct: 0 })).toEqual([
      'directBelowOne',
    ]);
    expect(channelWarnings({ code: 'WALKIN', multiplier: 0.9, commissionPct: 10 })).toEqual([
      'belowFloor',
      'directBelowOne',
    ]);
  });
});

describe('validateDraft', () => {
  it('chặn hoa hồng 100% (công thức sàn chia 0) và khoảng giá trị hợp đồng', () => {
    const draft = { ...draftOf(channel()), reason: 'x', commissionPct: '100' };
    expect(validateDraft(draft)).toEqual([{ field: 'commissionPct', issue: 'OUT_OF_RANGE' }]);
    expect(validateDraft({ ...draftOf(channel()), reason: 'x', multiplier: '6' })).toEqual([
      { field: 'multiplier', issue: 'OUT_OF_RANGE' },
    ]);
    expect(validateDraft({ ...draftOf(channel()), reason: 'x', holdMinutes: '1500' })).toEqual([
      { field: 'holdMinutes', issue: 'OUT_OF_RANGE' },
    ]);
  });

  it('bắt buộc lý do', () => {
    expect(validateDraft({ ...draftOf(channel()), reason: '  ' })).toEqual([
      { field: 'reason', issue: 'REQUIRED' },
    ]);
  });
});

describe('changedFields', () => {
  it('chỉ gửi trường thực sự đổi, cộng lý do', () => {
    const base = channel();
    expect(changedFields({ ...draftOf(base), reason: 'Đổi hoa hồng' }, base)).toEqual({
      reason: 'Đổi hoa hồng',
    });
    expect(
      changedFields(
        { ...draftOf(base), multiplier: '1,25', overbookAllowed: true, reason: 'x' },
        base,
      ),
    ).toEqual({ reason: 'x', multiplier: 1.25, overbookAllowed: true });
  });

  it('nhận dấu phẩy thập phân', () => {
    const changed = changedFields(
      { ...draftOf(channel()), commissionPct: '17,5', reason: 'x' },
      channel(),
    );
    expect(changed.commissionPct).toBe(17.5);
  });
});

describe('overrideUpdateRequest / validateOverride', () => {
  it('gửi dòng mới với effectiveFrom và chỉ trường đã khai', () => {
    expect(
      overrideUpdateRequest(
        { propertyId: 'p1', multiplier: '1,1', commissionPct: '', effectiveFrom: '2026-11-01' },
        'Ghi đè Đà Lạt',
      ),
    ).toEqual({
      reason: 'Ghi đè Đà Lạt',
      propertyOverrides: [{ propertyId: 'p1', effectiveFrom: '2026-11-01', multiplier: 1.1 }],
    });
  });

  it('bắt buộc cơ sở, ngày hiệu lực và ít nhất một giá trị ghi đè', () => {
    expect(validateOverride(EMPTY_OVERRIDE_DRAFT)).toEqual([
      { field: 'propertyId', issue: 'REQUIRED' },
      { field: 'effectiveFrom', issue: 'REQUIRED' },
      { field: 'multiplier', issue: 'NOTHING_TO_OVERRIDE' },
    ]);
    expect(
      validateOverride({
        propertyId: 'p1',
        effectiveFrom: '2026-11-01',
        multiplier: '',
        commissionPct: '',
      }),
    ).toEqual([{ field: 'multiplier', issue: 'NOTHING_TO_OVERRIDE' }]);
  });
});

describe('ifMatchOf', () => {
  it('đóng gói version thành ETag', () => {
    expect(ifMatchOf(4)).toBe('"4"');
  });
});
