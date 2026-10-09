/** HB-081: phần thuần SCR-03 — hết hạn báo giá và cờ chạm sàn/trần theo từng đêm. */
import { describe, expect, it } from 'vitest';
import type { Quote } from '@pinehill/contracts';
import {
  clampedDates,
  isExpired,
  nightRows,
} from '../../src/app/(guest)/rooms/[roomTypeId]/quote-model';

const QUOTE: Quote = {
  quoteId: 'q1',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: [
    {
      date: '2026-12-24',
      basePrice: 1_000_000,
      seasonMultiplier: 1,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 1_000_000,
    },
    {
      date: '2026-12-25',
      basePrice: 1_000_000,
      seasonMultiplier: 2,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: true,
      nightlyPrice: 2_000_000,
    },
  ],
  subtotal: 3_000_000,
  discountAmount: 0,
  total: 3_000_000,
  currency: 'VND',
  warnings: ['E_RATE_BELOW_FLOOR'],
  depositPercent: 30,
  depositAmount: 900_000,
  engineVersion: 'engine-1',
  quotedAt: '2026-10-08T02:00:00.000Z',
  expiresAt: '2026-10-08T02:15:00.000Z',
};

describe('isExpired (AC2)', () => {
  it('so theo expiresAt máy chủ trả', () => {
    expect(isExpired(QUOTE.expiresAt, Date.parse('2026-10-08T02:14:59.000Z'))).toBe(false);
    expect(isExpired(QUOTE.expiresAt, Date.parse('2026-10-08T02:15:00.000Z'))).toBe(true);
    expect(isExpired(QUOTE.expiresAt, Date.parse('2026-10-08T03:00:00.000Z'))).toBe(true);
  });

  it('mốc không hợp lệ thì không coi là hết hạn', () => {
    expect(isExpired('không-phải-mốc', Date.now())).toBe(false);
  });
});

describe('nightRows / clampedDates (AC1)', () => {
  it('chép nguyên số máy chủ trả và đánh dấu đêm chạm sàn/trần', () => {
    expect(nightRows(QUOTE)).toEqual([
      { date: '2026-12-24', nightlyPrice: 1_000_000, basePrice: 1_000_000, clamped: false },
      { date: '2026-12-25', nightlyPrice: 2_000_000, basePrice: 1_000_000, clamped: true },
    ]);
    expect(clampedDates(QUOTE)).toEqual(['2026-12-25']);
  });
});
