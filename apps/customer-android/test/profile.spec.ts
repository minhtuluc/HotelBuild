import { describe, expect, it } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import type { GuestLoyalty, GuestSummary } from '@pinehill/contracts';
import {
  TIER_LABEL_KEYS,
  loadProfile,
  loyaltyRows,
  profileApiFrom,
  profileRows,
  tierMismatch,
  type ProfileApi,
} from '../src/profile';

const GUEST: GuestSummary = {
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
};

const LOYALTY: GuestLoyalty = {
  guestId: 'g1',
  loyaltyTier: 'GOLD',
  loyaltyPoints: 1200,
  staysLast12Months: 3,
  totalStays: 7,
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

const api = (overrides: Partial<ProfileApi> = {}): ProfileApi => ({
  me: async () => GUEST,
  loyalty: async () => LOYALTY,
  ...overrides,
});

describe('SCR-83 hồ sơ khách trên Android (HB-115)', () => {
  it('dòng hồ sơ: email trống hiện gạch ngang, không bịa dữ liệu', () => {
    const rows = profileRows({ ...GUEST, email: null }, '—');
    expect(rows.map((row) => row.key)).toEqual(['name', 'phone', 'email', 'created', 'consent']);
    expect(rows.find((row) => row.key === 'email')?.value).toBe('—');
    expect(rows.find((row) => row.key === 'consent')?.value).toBe('yes');
  });

  it('ba con số tích luỹ lấy nguyên máy chủ trả và có nhãn cho đủ 5 hạng', () => {
    expect(loyaltyRows(LOYALTY)).toEqual([
      { key: 'points', value: 1200 },
      { key: 'stays12', value: 3 },
      { key: 'staysTotal', value: 7 },
    ]);
    expect(Object.keys(TIER_LABEL_KEYS).sort()).toEqual([
      'GOLD',
      'GUEST',
      'MEMBER',
      'PLATINUM',
      'SILVER',
    ]);
  });

  it('phát hiện hạng/điểm lệch giữa hồ sơ và tuyến điểm', () => {
    expect(tierMismatch(GUEST, LOYALTY)).toBe(false);
    expect(tierMismatch({ ...GUEST, loyaltyTier: 'SILVER' }, LOYALTY)).toBe(true);
    expect(tierMismatch({ ...GUEST, loyaltyPoints: 900 }, LOYALTY)).toBe(true);
  });

  it('offline thì báo cần kết nối và KHÔNG gọi mạng', async () => {
    let calls = 0;
    const counting = api({
      me: async () => {
        calls += 1;
        return GUEST;
      },
      loyalty: async () => {
        calls += 1;
        return LOYALTY;
      },
    });
    expect(await loadProfile({ api: counting, net: offline })).toEqual({ kind: 'offline' });
    expect(calls).toBe(0);
  });

  it('đọc hồ sơ + điểm của chính khách qua hai tuyến self (không gửi guestId)', async () => {
    const urls: string[] = [];
    const client = new ApiClient({
      baseUrl: 'https://api.test/api/v1',
      getAccessToken: () => 'token-1',
      maxAttempts: 1,
      sleep: async () => undefined,
      fetchImpl: (input) => {
        const request = new Request(input);
        urls.push(request.url);
        const body = request.url.endsWith('/loyalty') ? LOYALTY : GUEST;
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    });
    const outcome = await loadProfile({ api: profileApiFrom(client), net: online });
    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') {
      expect(outcome.profile.fullName).toBe('Nguyễn Văn An');
      expect(outcome.loyalty.loyaltyPoints).toBe(1200);
    }
    expect(urls.some((url) => url.endsWith('/guests/me'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/guests/me/loyalty'))).toBe(true);
    expect(urls.some((url) => url.includes('g1'))).toBe(false);
  });

  it('lỗi máy chủ thì trả mã để màn hình hiện câu chữ theo mã', async () => {
    const failure = { name: 'ApiError', message: 'x', code: 'E_GEN_NOT_FOUND' };
    expect(
      await loadProfile({
        api: api({
          me: async () => {
            throw failure;
          },
        }),
        net: online,
      }),
    ).toMatchObject({ kind: 'failed' });
  });
});
