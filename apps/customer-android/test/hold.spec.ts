import { describe, expect, it } from 'vitest';
import type { BookingSummary } from '@pinehill/contracts';
import {
  bookingRequestFor,
  bookingResult,
  continueEnabled,
  formatCountdown,
  guestIssue,
  holdRemaining,
  placeBooking,
  type HoldApi,
  type HoldInput,
} from '../src/hold';

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

const INPUT: HoldInput = {
  criteria: {
    propertyId: 'synthetic-property',
    roomTypeId: 'rt-1',
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    adults: 2,
    children: 0,
    roomCount: 1,
  },
  ratePlanCode: 'SAVER3',
  quoteId: 'q1',
  guest: { fullName: 'Nguyễn Văn An', phone: '0912345678' },
};

function booking(duplicateSuspected: boolean): BookingSummary {
  return {
    id: 'b1',
    code: 'SYN079',
    seq: 1,
    status: 'HELD',
    guestId: 'g1',
    propertyId: 'synthetic-property',
    roomTypeId: 'rt-1',
    ratePlanId: 'SAVER3',
    channelId: 'web',
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    nights: 2,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: 2_000_000,
    depositPercent: 30,
    depositAmount: 600_000,
    paidAmount: 0,
    refundedAmount: 0,
    balanceDue: 2_000_000,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: '2026-12-01T00:15:00.000Z',
    oversold: false,
    priceLocked: false,
    duplicateSuspected,
    channelPolicyCode: null,
    note: null,
    createdBy: 'g1',
    createdAt: '2026-12-01T00:00:00.000Z',
  };
}

const api = (overrides: Partial<HoldApi> = {}): HoldApi => ({
  quote: async () => ({ quoteId: 'q-session' }),
  book: async () => booking(false),
  ...overrides,
});

const EXPIRES = '2026-12-01T00:15:00.000Z';

describe('SCR-76/SCR-78 xác nhận & giữ chỗ trên Android (HB-087)', () => {
  it('thân lệnh đặt phòng đúng kênh khách, đúng gói và đúng kỳ', () => {
    expect(bookingRequestFor(INPUT)).toMatchObject({
      channelCode: 'WEB',
      ratePlanCode: 'SAVER3',
      quoteId: 'q1',
      roomTypeId: 'rt-1',
      guest: { fullName: 'Nguyễn Văn An', phone: '0912345678' },
    });
    expect(bookingRequestFor({ ...INPUT, note: '  ' })).not.toHaveProperty('note');
    expect(bookingRequestFor({ ...INPUT, note: 'Đến muộn' }).note).toBe('Đến muộn');
  });

  it('đếm ngược theo holdExpiresAt của booking máy chủ trả; hết hạn thì khoá tiếp tục (AC1)', () => {
    const before = Date.parse('2026-12-01T00:14:00.000Z');
    const at = Date.parse(EXPIRES);
    const held = booking(false);
    expect(holdRemaining(EXPIRES, before)).toBe(60_000);
    expect(holdRemaining(EXPIRES, at)).toBe(0);
    expect(holdRemaining('không-phải-mốc', before)).toBeNull();
    expect(continueEnabled(held, before)).toBe(true);
    expect(continueEnabled(held, at)).toBe(false);
    expect(continueEnabled(null, before)).toBe(false);
    expect(continueEnabled({ ...held, holdExpiresAt: 'không-phải-mốc' }, before)).toBe(false);
    // Kênh không giữ chỗ (PENDING_PAYMENT) không có hạn: được mở tiếp ngay.
    expect(continueEnabled({ ...held, status: 'PENDING_PAYMENT', holdExpiresAt: null }, at)).toBe(
      true,
    );
  });

  it('định dạng đếm ngược mm:ss và h:mm:ss', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5_000)).toBe('00:00');
    expect(formatCountdown(59_000)).toBe('00:59');
    expect(formatCountdown(3_661_000)).toBe('1:01:01');
  });

  it('offline thì báo cần kết nối và không gọi mạng', async () => {
    let calls = 0;
    const counting = api({
      quote: async () => {
        calls += 1;
        return { quoteId: 'q' };
      },
      book: async () => {
        calls += 1;
        return booking(false);
      },
    });
    expect(await placeBooking({ api: counting, net: offline }, INPUT)).toEqual({ kind: 'offline' });
    expect(calls).toBe(0);
  });

  it('HB-253: một lệnh POST /bookings bằng báo giá lấy trong phiên — không gọi POST /holds', async () => {
    // POST /holds tạo booking HELD không có snapshot giá/nghĩa vụ phòng: số dư trả 500 và không
    // thanh toán được (máy thật, PH-261117-00002). POST /bookings tự giữ chỗ (HELD + holdExpiresAt).
    const quoted: unknown[] = [];
    const booked: string[] = [];
    const outcome = await placeBooking(
      {
        api: api({
          quote: async (request) => {
            quoted.push(request);
            return { quoteId: 'q-session' };
          },
          book: async (request) => {
            booked.push(request.quoteId);
            return booking(false);
          },
        }),
        net: online,
      },
      INPUT,
    );
    expect(quoted).toEqual([
      {
        propertyId: 'synthetic-property',
        roomTypeId: 'rt-1',
        channelCode: 'WEB',
        ratePlanCode: 'SAVER3',
        checkIn: '2026-12-24',
        checkOut: '2026-12-26',
        adults: 2,
        children: 0,
        roomCount: 1,
      },
    ]);
    expect(booked).toEqual(['q-session']);
    expect(outcome).toEqual({ kind: 'ready', booking: booking(false) });
    expect(Object.keys(api())).toEqual(['quote', 'book']);
  });

  it('máy chủ nghi trùng thì trả duplicate để hỏi khách (AC1)', async () => {
    const duplicate = await placeBooking(
      { api: api({ book: async () => booking(true) }), net: online },
      INPUT,
    );
    expect(duplicate.kind).toBe('duplicate');
  });

  it('lỗi máy chủ thì trả mã để màn hình hiện câu chữ theo mã', async () => {
    const failure = { name: 'ApiError', message: 'x', code: 'E_INV_NO_AVAILABILITY' };
    expect(
      await placeBooking(
        {
          api: api({
            book: async () => {
              throw failure;
            },
          }),
          net: online,
        },
        INPUT,
      ),
    ).toMatchObject({ kind: 'failed' });
  });

  it('suy kết quả đặt phòng: offline, mã lỗi, nghi trùng đều tách bạch', () => {
    expect(bookingResult({ kind: 'offline' })).toEqual({
      offline: true,
      failedCode: null,
      booking: null,
      duplicate: false,
    });
    expect(bookingResult({ kind: 'failed', code: null }).failedCode).toBe('UNKNOWN');
    expect(bookingResult({ kind: 'ready', booking: booking(false) }).duplicate).toBe(false);
    expect(bookingResult({ kind: 'duplicate', booking: booking(true) }).duplicate).toBe(true);
  });

  it('kiểm họ tên/SĐT khách tại chỗ trước khi gửi', () => {
    expect(guestIssue({ fullName: '', phone: '0912345678' })).toBe('NAME');
    expect(guestIssue({ fullName: 'An', phone: '123' })).toBe('PHONE');
    expect(guestIssue({ fullName: 'An', phone: '+84912345678' })).toBeNull();
    expect(guestIssue({ fullName: 'An', phone: '0912345678' })).toBeNull();
  });
});
