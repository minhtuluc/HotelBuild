/** HB-082: phần thuần SCR-04/05 — số bước journey, kiểm thông tin khách, điều khoản gói. */
import { describe, expect, it } from 'vitest';
import type { RatePlanPublic } from '@pinehill/contracts';
import {
  JOURNEY_STEPS,
  duplicateChoices,
  guestIssues,
  planTerms,
} from '../../src/app/(guest)/book/book-model';

const PLAN: RatePlanPublic = {
  code: 'FLEX7',
  name: 'Linh hoạt 7 ngày',
  minNights: 1,
  maxNights: 30,
  depositPercent: 30,
};

const PLAN_WITH_FREE_CANCEL: RatePlanPublic = { ...PLAN, freeCancelHours: 72 };

describe('JOURNEY_STEPS (AC1 — ≤ 4 bước)', () => {
  it('journey khách tới xác nhận chỉ có 4 bước bắt buộc', () => {
    expect(JOURNEY_STEPS).toEqual(['find', 'results', 'detail', 'confirm']);
    expect(JOURNEY_STEPS.length).toBeLessThanOrEqual(4);
  });
});

describe('guestIssues (AC1)', () => {
  it('bắt buộc họ tên và số điện thoại đúng dạng 0…/+84…', () => {
    expect(guestIssues({ fullName: '', phone: '', note: '' })).toEqual([
      { field: 'guest.fullName', issue: 'REQUIRED' },
      { field: 'guest.phone', issue: 'NOT_PHONE' },
    ]);
    expect(guestIssues({ fullName: 'Nguyễn Văn An', phone: '123', note: '' })).toEqual([
      { field: 'guest.phone', issue: 'NOT_PHONE' },
    ]);
  });

  it('nhận cả hai dạng số điện thoại hợp lệ và bỏ qua ghi chú', () => {
    expect(guestIssues({ fullName: 'Nguyễn Văn An', phone: '0912345678', note: '' })).toEqual([]);
    expect(guestIssues({ fullName: 'An', phone: '+84912345678', note: 'Đến muộn' })).toEqual([]);
  });
});

describe('planTerms (AC1)', () => {
  it('lấy nguyên điều khoản công khai, mốc huỷ miễn phí để null khi gói không công bố', () => {
    expect(planTerms(PLAN)).toEqual({
      depositPercent: 30,
      freeCancelHours: null,
      minNights: 1,
      maxNights: 30,
    });
    expect(planTerms(PLAN_WITH_FREE_CANCEL).freeCancelHours).toBe(72);
  });
});

describe('duplicateChoices (AC2)', () => {
  it('mở booking cũ bằng liên kết tới màn kết quả đặt', () => {
    expect(duplicateChoices('bk 1')).toEqual({
      openHref: '/booking/bk%201',
      keepEditing: true,
    });
  });
});
