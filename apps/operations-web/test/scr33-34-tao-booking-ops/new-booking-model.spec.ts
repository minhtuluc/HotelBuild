import { describe, expect, it } from 'vitest';
import { quoteSchema } from '@pinehill/contracts';
import type { ChannelSummary, GuestSummary } from '@pinehill/contracts';
import {
  EMPTY_DRAFT,
  STEPS,
  bookingRequestOf,
  channelOf,
  depositOf,
  guestByPhone,
  holdMinutesOf,
  nextStep,
  nightsBetween,
  planCodeOf,
  previousStep,
  quoteRequestOf,
  stepIssue,
  type NewBookingDraft,
} from '../../src/app/(ops)/bookings/new/new-booking-model';

const DRAFT: NewBookingDraft = {
  channel: 'PHONE',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  adults: 2,
  children: 0,
  roomCount: 1,
  guest: { fullName: 'Nguyễn Văn An', phone: '0912345678' },
};

const channel = (code: ChannelSummary['code'], holdMinutes: number): ChannelSummary => ({
  id: `c-${code}`,
  code,
  name: code,
  multiplier: 1,
  commissionPct: 0,
  holdMinutes,
  overbookAllowed: false,
  version: 1,
});

const QUOTE = quoteSchema.parse({
  quoteId: 'q1',
  channelCode: 'PHONE',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  nights: [],
  subtotal: 2_000_000,
  discountAmount: 0,
  total: 2_000_000,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 600_000,
  engineVersion: 'v1',
  quotedAt: '2026-12-01T00:00:00.000Z',
  expiresAt: '2026-12-01T00:15:00.000Z',
});

describe('SCR-33/SCR-34 tạo booking tại quầy/điện thoại (HB-107)', () => {
  it('luồng đúng 5 bước và đi tiến/lùi được', () => {
    expect(STEPS).toHaveLength(5);
    expect(nextStep('channel')).toBe('room');
    expect(nextStep('confirm')).toBe('done');
    expect(nextStep('done')).toBe('done');
    expect(previousStep('room')).toBe('channel');
    expect(previousStep('channel')).toBe('channel');
  });

  it('chặn tại chỗ theo từng bước, không gọi API khi thiếu dữ liệu', () => {
    expect(stepIssue('channel', EMPTY_DRAFT)).toBe('PROPERTY');
    expect(stepIssue('room', { ...DRAFT, checkOut: '2026-12-24' })).toBe('DATES');
    expect(stepIssue('room', { ...DRAFT, ratePlanCode: '' })).toBe('ROOM');
    expect(stepIssue('guest', { ...DRAFT, guest: { fullName: '', phone: '0912345678' } })).toBe(
      'NAME',
    );
    expect(stepIssue('guest', { ...DRAFT, guest: { fullName: 'An', phone: '123' } })).toBe('PHONE');
    expect(stepIssue('guest', DRAFT)).toBeNull();
    expect(stepIssue('confirm', DRAFT)).toBeNull();
    expect(nightsBetween('2026-12-24', '2026-12-26')).toBe(2);
  });

  it('báo giá và thân lệnh đặt phòng dùng đúng kênh đang tạo (WALKIN/PHONE)', () => {
    expect(quoteRequestOf(DRAFT)).toMatchObject({ channelCode: 'PHONE', ratePlanCode: 'FLEX7' });
    expect(quoteRequestOf({ ...DRAFT, ratePlanCode: '' })).toBeNull();
    expect(bookingRequestOf(DRAFT, 'q1')).toMatchObject({
      channelCode: 'PHONE',
      quoteId: 'q1',
      guest: { fullName: 'Nguyễn Văn An', phone: '0912345678' },
    });
    expect(quoteRequestOf({ ...DRAFT, channel: 'WALKIN' })).toMatchObject({
      channelCode: 'WALKIN',
    });
    expect(planCodeOf('FLEX7')).toBe('FLEX7');
    expect(planCodeOf('KHONG-CO')).toBeNull();
  });

  it('holdMinutes lấy từ cấu hình kênh máy chủ trả (PHONE 1440 theo thiết kế)', () => {
    const channels = [channel('WALKIN', 30), channel('PHONE', 1440)];
    expect(holdMinutesOf(channels, 'PHONE')).toBe(1440);
    expect(holdMinutesOf(channels, 'WALKIN')).toBe(30);
    expect(holdMinutesOf([], 'PHONE')).toBeNull();
    expect(channelOf(channels, 'PHONE')?.code).toBe('PHONE');
  });

  it('tra khách theo SĐT đã chuẩn hoá 0…/84…/+84…', () => {
    const guests: readonly GuestSummary[] = [
      {
        id: 'g1',
        fullName: 'Nguyễn Văn An',
        phone: '+84912345678',
        email: null,
        loyaltyTier: 'GOLD',
        loyaltyPoints: 1200,
        totalStays: 3,
        blacklisted: false,
        consentMarketing: true,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    expect(guestByPhone(guests, '0912345678')?.id).toBe('g1');
    expect(guestByPhone(guests, '+84912345678')?.id).toBe('g1');
    expect(guestByPhone(guests, '0900000000')).toBeUndefined();
  });

  it('tiền cọc lấy nguyên từ báo giá máy chủ trả', () => {
    expect(depositOf(QUOTE)).toEqual({ percent: 30, amount: 600_000 });
  });
});
