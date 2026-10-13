import { describe, expect, it } from 'vitest';
import type { CancellationPolicy, RatePlanAdmin } from '@pinehill/contracts';
import {
  ifMatchOf,
  policyDiff,
  policyDraftOf,
  policyUpdateRequest,
  ratePlanDiff,
  ratePlanDraftOf,
  ratePlanUpdateRequest,
  tierIndexFromField,
  validateRatePlanDraft,
  validateTiers,
  type TierRow,
} from '../src/lib/rate-plans';

const PLAN: RatePlanAdmin = {
  id: 'rp1',
  code: 'FLEX7',
  name: 'Linh hoạt 7 ngày',
  minNights: 1,
  maxNights: 7,
  depositPercent: 30,
  cancellationPolicyId: 'cp1',
  status: 'ACTIVE',
  version: 3,
};

const POLICY: CancellationPolicy = {
  id: 'cp1',
  name: 'Linh hoạt 7 ngày (FLEX7)',
  status: 'ACTIVE',
  tiers: [
    { hoursBeforeCheckIn: 168, refundPercent: 100 },
    { hoursBeforeCheckIn: 72, refundPercent: 50 },
    { hoursBeforeCheckIn: 24, refundPercent: 0 },
    { hoursBeforeCheckIn: 0, refundPercent: 0 },
  ],
  earlyCheckoutFreeHours: 72,
  earlyCheckoutRefundPct: 50,
  version: 4,
};

const rows = (...pairs: readonly (readonly [number, number])[]): TierRow[] =>
  pairs.map(([hoursBeforeCheckIn, refundPercent]) => ({
    hoursBeforeCheckIn: String(hoursBeforeCheckIn),
    refundPercent: String(refundPercent),
  }));

describe('validateTiers — validate theo hàng (AC3, BR-RATE-20)', () => {
  it('bậc hợp lệ (mốc giảm dần, hoàn không tăng, bắt tất cuối) không sinh lỗi', () => {
    expect(validateTiers(rows([168, 100], [72, 50], [24, 0], [0, 0]))).toEqual([]);
  });

  it('mốc giờ không giảm dần / trùng thì tô đúng hàng', () => {
    const issues = validateTiers(rows([72, 100], [168, 50], [0, 0]));
    expect(issues).toContainEqual({
      index: 1,
      field: 'hoursBeforeCheckIn',
      issue: 'NOT_DESCENDING',
    });
  });

  it('phần trăm ngoài 0–100 thì tô đúng hàng', () => {
    const issues = validateTiers(rows([168, 120], [0, 0]));
    expect(issues).toContainEqual({ index: 0, field: 'refundPercent', issue: 'OUT_OF_RANGE' });
  });

  it('hoàn tăng khi huỷ muộn hơn thì chặn (BR-RATE-20)', () => {
    const issues = validateTiers(rows([168, 50], [24, 100], [0, 0]));
    expect(issues).toContainEqual({ index: 1, field: 'refundPercent', issue: 'INCREASING' });
  });

  it('thiếu bậc bắt tất (không có mốc 0) thì chặn', () => {
    const issues = validateTiers(rows([168, 100], [24, 0]));
    expect(issues).toContainEqual({
      index: 1,
      field: 'hoursBeforeCheckIn',
      issue: 'MISSING_CATCH_ALL',
    });
  });

  it('bậc bắt tất không ở cuối thì chặn', () => {
    const issues = validateTiers(rows([168, 100], [0, 0], [24, 0]));
    expect(issues).toContainEqual({
      index: 2,
      field: 'hoursBeforeCheckIn',
      issue: 'CATCH_ALL_NOT_LAST',
    });
  });

  // BR-RATE-20 has no four-tier cap; match published HB057 and retain empty rejection.
  it('năm bậc đúng BR được chấp nhận; rỗng thì chặn', () => {
    expect(validateTiers(rows([168, 100], [72, 50], [24, 0], [12, 0], [0, 0]))).toEqual([]);
    expect(validateTiers([])).toEqual([{ index: -1, field: 'hoursBeforeCheckIn', issue: 'EMPTY' }]);
  });
});

describe('tierIndexFromField (AC5)', () => {
  it('trích chỉ số bậc từ field lồng', () => {
    expect(tierIndexFromField('tiers[2].hoursBeforeCheckIn')).toBe(2);
    expect(tierIndexFromField('tiers.1.refundPercent')).toBe(1);
    expect(tierIndexFromField('reason')).toBeNull();
  });
});

describe('rate plan (AC7)', () => {
  it('lý do bắt buộc; cọc 0–100; minNights ≤ maxNights', () => {
    const draft = { ...ratePlanDraftOf(PLAN), reason: '' };
    expect(validateRatePlanDraft(draft, PLAN)).toContainEqual({
      field: 'reason',
      issue: 'REQUIRED',
    });
    const bad = { ...ratePlanDraftOf(PLAN), reason: 'x', depositPercent: '101', minNights: '9' };
    expect(validateRatePlanDraft(bad, PLAN)).toContainEqual({
      field: 'depositPercent',
      issue: 'OUT_OF_RANGE',
    });
    expect(validateRatePlanDraft(bad, PLAN)).toContainEqual({
      field: 'maxNights',
      issue: 'BELOW_MIN',
    });
  });

  it('chỉ gửi trường thực sự đổi cộng reason', () => {
    const draft = { ...ratePlanDraftOf(PLAN), depositPercent: '40', reason: 'Tăng cọc' };
    const request = ratePlanUpdateRequest(draft, PLAN);
    expect(request).toEqual({ reason: 'Tăng cọc', depositPercent: 40 });
    expect(request).not.toHaveProperty('minNights');
  });
});

describe('cancellation policy (AC4, AC6)', () => {
  it('gửi toàn bộ bậc + ngoại lệ trả phòng sớm + lý do', () => {
    const draft = policyDraftOf(POLICY);
    draft.reason = 'Đổi chính sách';
    const request = policyUpdateRequest(draft);
    expect(request.tiers).toHaveLength(4);
    expect(request.tiers[0]).toEqual({ hoursBeforeCheckIn: 168, refundPercent: 100 });
    expect(request.earlyCheckoutFreeHours).toBe(72);
    expect(request.reason).toBe('Đổi chính sách');
  });

  it('diff 412 chỉ so trường sửa được', () => {
    const draft = { ...policyDraftOf(POLICY), earlyCheckoutRefundPct: '60', reason: 'x' };
    const diff = policyDiff(draft, POLICY);
    expect(diff).toContainEqual({
      label: 'earlyCheckoutRefundPct',
      local: '60',
      server: '50',
    });
    const planDiff = ratePlanDiff({ ...ratePlanDraftOf(PLAN), status: 'INACTIVE' }, PLAN);
    expect(planDiff).toContainEqual({ label: 'status', local: 'INACTIVE', server: 'ACTIVE' });
  });
});

describe('ifMatchOf', () => {
  it('đóng gói version thành ETag', () => {
    expect(ifMatchOf(3)).toBe('"3"');
  });
});
