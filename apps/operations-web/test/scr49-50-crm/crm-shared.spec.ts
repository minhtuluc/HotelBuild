/** HB-167: phần thuần SCR-49/SCR-50 — tham số tra cứu, kiểm ẩn danh hoá/danh sách đen, nhãn hạng. */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SEARCH,
  TIER_LABEL_KEY,
  anonymizeIssues,
  anonymizeRequest,
  blacklistIssues,
  searchParams,
} from '../../src/app/(ops)/crm/crm-shared';

describe('searchParams (AC1)', () => {
  it('bỏ bộ lọc rỗng, giữ đúng giá trị đã chọn', () => {
    expect(searchParams(EMPTY_SEARCH)).toEqual({});
    expect(searchParams({ q: '  An  ', loyaltyTier: 'GOLD', blacklisted: 'ALL' })).toEqual({
      q: 'An',
      loyaltyTier: 'GOLD',
    });
    expect(searchParams({ q: '', loyaltyTier: '', blacklisted: 'YES' })).toEqual({
      blacklisted: true,
    });
    expect(searchParams({ q: '', loyaltyTier: '', blacklisted: 'NO' })).toEqual({
      blacklisted: false,
    });
  });
});

describe('anonymizeIssues (AC1, BR-CRM-05)', () => {
  it('bắt buộc lý do và phải xác nhận trong hộp thoại', () => {
    expect(anonymizeIssues('', false)).toEqual([
      { field: 'reason', issue: 'REQUIRED' },
      { field: 'confirmed', issue: 'NOT_CONFIRMED' },
    ]);
    expect(anonymizeIssues('Khách yêu cầu', false)).toEqual([
      { field: 'confirmed', issue: 'NOT_CONFIRMED' },
    ]);
    expect(anonymizeIssues('Khách yêu cầu', true)).toEqual([]);
  });

  it('thân lệnh giữ lý do đã cắt khoảng trắng và mốc yêu cầu', () => {
    expect(anonymizeRequest('  Khách yêu cầu  ', '2026-10-02T00:00:00.000Z')).toEqual({
      reason: 'Khách yêu cầu',
      requestedAt: '2026-10-02T00:00:00.000Z',
    });
  });
});

describe('blacklistIssues (AC1, BR-CRM-04)', () => {
  it('thiếu lý do thì chặn, có lý do thì qua', () => {
    expect(blacklistIssues('   ')).toEqual([{ field: 'blacklistReason', issue: 'REQUIRED' }]);
    expect(blacklistIssues('Quỵt tiền phòng')).toEqual([]);
  });
});

describe('TIER_LABEL_KEY (AC2)', () => {
  it('đủ năm hạng hợp đồng để hiển thị nhãn', () => {
    expect(Object.keys(TIER_LABEL_KEY).sort()).toEqual([
      'GOLD',
      'GUEST',
      'MEMBER',
      'PLATINUM',
      'SILVER',
    ]);
  });
});
