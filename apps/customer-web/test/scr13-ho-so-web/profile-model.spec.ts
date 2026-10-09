import { describe, expect, it } from 'vitest';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';
import {
  TIER_KEYS,
  loyaltyRows,
  profileRows,
  tierMismatch,
} from '../../src/app/(guest)/profile/profile-model';

function guest(overrides: Partial<GuestSummary> = {}): GuestSummary {
  return {
    id: 'g1',
    fullName: 'Nguyễn Văn An',
    phone: '+84912345678',
    email: 'an@example.com',
    loyaltyTier: 'GOLD',
    loyaltyPoints: 1200,
    totalStays: 7,
    blacklisted: false,
    consentMarketing: true,
    createdAt: '2026-09-19T03:14:02.000Z',
    ...overrides,
  };
}

function loyalty(overrides: Partial<GuestLoyalty> = {}): GuestLoyalty {
  return {
    guestId: 'g1',
    loyaltyTier: 'GOLD',
    loyaltyPoints: 1200,
    staysLast12Months: 3,
    totalStays: 7,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SCR-13 hồ sơ khách & điểm (HB-105)', () => {
  it('có nhãn cho đủ năm hạng thành viên', () => {
    expect(Object.keys(TIER_KEYS).sort()).toEqual([
      'GOLD',
      'GUEST',
      'MEMBER',
      'PLATINUM',
      'SILVER',
    ]);
  });

  it('email trống thì hiện gạch ngang, không bịa dữ liệu', () => {
    const rows = profileRows(guest({ email: null }), '—');
    expect(rows.map((row) => row.key)).toEqual(['name', 'phone', 'email', 'created', 'consent']);
    expect(rows.find((row) => row.key === 'email')?.value).toBe('—');
    expect(rows.find((row) => row.key === 'consent')?.value).toBe('yes');
  });

  it('ba con số tích luỹ lấy nguyên từ máy chủ', () => {
    expect(loyaltyRows(loyalty())).toEqual([
      { key: 'points', value: 1200 },
      { key: 'stays12', value: 3 },
      { key: 'staysTotal', value: 7 },
    ]);
  });

  it('phát hiện hạng/điểm lệch giữa hồ sơ và tuyến điểm', () => {
    expect(tierMismatch(guest(), loyalty())).toBe(false);
    expect(tierMismatch(guest({ loyaltyTier: 'SILVER' }), loyalty())).toBe(true);
    expect(tierMismatch(guest({ loyaltyPoints: 900 }), loyalty())).toBe(true);
  });
});
