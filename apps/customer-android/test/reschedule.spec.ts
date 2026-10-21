import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { BookingSummary, Quote, QuoteRequest, RescheduleRequest } from '@pinehill/contracts';
import {
  actionStates,
  confirmReschedule,
  isSameStay,
  loadNewQuote,
  nightsBetween,
  rescheduleRequestFor,
  stayDifference,
  stayIssue,
  type RescheduleApi,
} from '../src/reschedule';

const online = { getConnected: async () => true };
const offline = { getConnected: async () => false };

function booking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: 'b1',
    code: 'PH-2601-00001',
    seq: 1,
    status: 'CONFIRMED',
    guestId: 'g1',
    propertyId: 'p1',
    roomTypeId: 'rt1',
    ratePlanId: 'FLEX7',
    channelId: 'c1',
    checkIn: '2026-12-24',
    checkOut: '2026-12-26',
    nights: 2,
    adults: 2,
    children: 0,
    roomCount: 1,
    totalAmount: 2_000_000,
    depositPercent: 30,
    depositAmount: 600_000,
    paidAmount: 600_000,
    refundedAmount: 0,
    balanceDue: 1_400_000,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: null,
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'g1',
    createdAt: '2026-12-01T00:00:00.000Z',
    ...overrides,
  };
}

const QUOTE: Quote = {
  quoteId: 'q-new',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-27',
  checkOut: '2026-12-29',
  nights: [
    {
      date: '2026-12-27',
      basePrice: 900_000,
      seasonMultiplier: 1,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 900_000,
    },
    {
      date: '2026-12-28',
      basePrice: 900_000,
      seasonMultiplier: 1,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 900_000,
    },
  ],
  subtotal: 1_800_000,
  discountAmount: 0,
  total: 1_800_000,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 540_000,
  engineVersion: '1.0.0',
  quotedAt: '2026-12-20T00:00:00.000Z',
  expiresAt: '2026-12-20T00:15:00.000Z',
};

/** 00:05 — trước mốc hết hạn của `QUOTE`. */
const NOW = Date.parse('2026-12-20T00:05:00.000Z');

function stubApi() {
  const quote = vi.fn(async (_request: QuoteRequest) => QUOTE);
  const reschedule = vi.fn(async (_bookingId: string, _request: RescheduleRequest) =>
    booking({ checkIn: '2026-12-27', checkOut: '2026-12-29', rescheduleCount: 1 }),
  );
  const api: RescheduleApi = { quote, reschedule };
  return { api, quote, reschedule };
}

const BASE_GATE = {
  step: 'idle' as const,
  online: true,
  issue: null,
  same: false,
  quote: null,
  nowMs: NOW,
};

describe('SCR-82 đổi ngày lưu trú trên Android (HB-114)', () => {
  it('kỳ mới phải hợp lệ: thiếu mốc, sai thứ tự, ngoài 1…365 đêm', () => {
    expect(stayIssue('', '2026-12-26')).toBe('MISSING');
    expect(stayIssue('2026-12-26', '2026-12-26')).toBe('ORDER');
    expect(stayIssue('2026-12-26', '2026-12-24')).toBe('ORDER');
    expect(stayIssue('2026-12-24', '2027-12-26')).toBe('RANGE');
    expect(stayIssue('2026-12-24', '2026-12-26')).toBeNull();
    expect(nightsBetween('2026-12-24', '2026-12-26')).toBe(2);
    expect(nightsBetween('2026-12-24', '2026-12-24')).toBeNull();
  });

  it('trùng kỳ đang giữ thì không cần đổi; chênh lệch là hiệu hai số máy chủ trả', () => {
    expect(isSameStay(booking(), { checkIn: '2026-12-24', checkOut: '2026-12-26' })).toBe(true);
    expect(isSameStay(booking(), { checkIn: '2026-12-27', checkOut: '2026-12-29' })).toBe(false);
    expect(stayDifference(2_500_000, 2_000_000)).toEqual({ kind: 'more', amount: 500_000 });
    expect(stayDifference(1_800_000, 2_000_000)).toEqual({ kind: 'less', amount: 200_000 });
    expect(stayDifference(2_000_000, 2_000_000)).toEqual({ kind: 'same', amount: 0 });
  });

  it('chỉ mở nút xác nhận khi có báo giá còn hạn và đang online (AC1)', () => {
    expect(actionStates(BASE_GATE)).toEqual({
      quoteDisabled: false,
      confirmDisabled: true,
      quoteExpired: false,
    });
    expect(actionStates({ ...BASE_GATE, online: false })).toEqual({
      quoteDisabled: true,
      confirmDisabled: true,
      quoteExpired: false,
    });
    expect(actionStates({ ...BASE_GATE, issue: 'ORDER' })).toEqual({
      quoteDisabled: true,
      confirmDisabled: true,
      quoteExpired: false,
    });
    expect(actionStates({ ...BASE_GATE, same: true })).toEqual({
      quoteDisabled: true,
      confirmDisabled: true,
      quoteExpired: false,
    });
    expect(actionStates({ ...BASE_GATE, step: 'quoting' })).toEqual({
      quoteDisabled: true,
      confirmDisabled: true,
      quoteExpired: false,
    });
    expect(actionStates({ ...BASE_GATE, step: 'quoted', quote: QUOTE })).toEqual({
      quoteDisabled: false,
      confirmDisabled: false,
      quoteExpired: false,
    });
    expect(actionStates({ ...BASE_GATE, step: 'quoted', quote: QUOTE, online: false })).toEqual({
      quoteDisabled: true,
      confirmDisabled: true,
      quoteExpired: false,
    });
  });

  it('báo giá quá hạn: khoá xác nhận nhưng vẫn cho lấy giá mới', () => {
    expect(
      actionStates({
        ...BASE_GATE,
        step: 'quoted',
        quote: { ...QUOTE, expiresAt: '2026-12-20T00:00:00.000Z' },
      }),
    ).toEqual({ quoteDisabled: false, confirmDisabled: true, quoteExpired: true });
  });

  it('offline: không gọi máy chủ khi xem chênh lệch (QĐ-03 quyết định 6)', async () => {
    const { api, quote } = stubApi();
    expect(
      await loadNewQuote({ api, net: offline }, booking(), '2026-12-27', '2026-12-29'),
    ).toEqual({ kind: 'offline' });
    expect(quote).not.toHaveBeenCalled();
  });

  it('gói không phải mã công bố thì không tự lấy giá', async () => {
    const { api, quote } = stubApi();
    expect(
      await loadNewQuote(
        { api, net: online },
        booking({ ratePlanId: 'CUSTOM-PLAN' }),
        '2026-12-27',
        '2026-12-29',
      ),
    ).toEqual({ kind: 'invalidPlan' });
    expect(quote).not.toHaveBeenCalled();
  });

  it('báo giá kỳ mới dùng đúng cơ sở/loại phòng/gói đang giữ, kèm kỳ mới', async () => {
    const { api, quote } = stubApi();
    expect(await loadNewQuote({ api, net: online }, booking(), '2026-12-27', '2026-12-29')).toEqual(
      { kind: 'ready', quote: QUOTE },
    );
    expect(quote).toHaveBeenCalledWith({
      propertyId: 'p1',
      roomTypeId: 'rt1',
      channelCode: 'WEB',
      ratePlanCode: 'FLEX7',
      checkIn: '2026-12-27',
      checkOut: '2026-12-29',
      adults: 2,
      children: 0,
      roomCount: 1,
    });
  });

  it('lỗi báo giá trả mã để màn hình dịch', async () => {
    const quote = vi.fn(async (_request: QuoteRequest) => {
      throw new ApiError({
        kind: 'http',
        message: 'Hết phòng',
        status: 409,
        code: 'E_INV_NO_AVAILABILITY',
      });
    });
    const api: RescheduleApi = { quote, reschedule: vi.fn() };
    expect(await loadNewQuote({ api, net: online }, booking(), '2026-12-27', '2026-12-29')).toEqual(
      { kind: 'failed', code: 'E_INV_NO_AVAILABILITY' },
    );
  });

  it('thân lệnh đổi ngày mang quoteId; lý do rỗng thì bỏ trường', () => {
    expect(
      rescheduleRequestFor({
        checkIn: '2026-12-27',
        checkOut: '2026-12-29',
        quoteId: 'q-new',
        note: '   ',
      }),
    ).toEqual({ checkIn: '2026-12-27', checkOut: '2026-12-29', quoteId: 'q-new' });
    expect(
      rescheduleRequestFor({
        checkIn: '2026-12-27',
        checkOut: '2026-12-29',
        quoteId: 'q-new',
        note: '  đổi vì công tác  ',
      }),
    ).toEqual({
      checkIn: '2026-12-27',
      checkOut: '2026-12-29',
      quoteId: 'q-new',
      reason: 'đổi vì công tác',
    });
  });

  it('xác nhận offline thì không gọi máy chủ', async () => {
    const { api, reschedule } = stubApi();
    const request = rescheduleRequestFor({
      checkIn: '2026-12-27',
      checkOut: '2026-12-29',
      quoteId: 'q-new',
      note: '',
    });
    expect(await confirmReschedule({ api, net: offline }, 'b1', request)).toEqual({
      kind: 'offline',
    });
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('xác nhận thành công: trả booking máy chủ vừa đổi, không tự suy số', async () => {
    const { api, reschedule } = stubApi();
    const request = rescheduleRequestFor({
      checkIn: '2026-12-27',
      checkOut: '2026-12-29',
      quoteId: 'q-new',
      note: '',
    });
    const outcome = await confirmReschedule({ api, net: online }, 'b1', request);
    expect(outcome.kind).toBe('done');
    expect(outcome.kind === 'done' ? outcome.booking.rescheduleCount : null).toBe(1);
    expect(reschedule).toHaveBeenCalledWith('b1', request);
  });

  it('xác nhận lỗi: trả mã, không coi là đã đổi', async () => {
    const quote = vi.fn(async (_request: QuoteRequest) => QUOTE);
    const reschedule = vi.fn(async (_bookingId: string, _request: RescheduleRequest) => {
      throw new ApiError({
        kind: 'http',
        message: 'Xung đột',
        status: 409,
        code: 'E_BOOK_RESCHEDULE_LIMIT',
      });
    });
    const api: RescheduleApi = { quote, reschedule };
    expect(
      await confirmReschedule(
        { api, net: online },
        'b1',
        rescheduleRequestFor({
          checkIn: '2026-12-27',
          checkOut: '2026-12-29',
          quoteId: 'q-new',
          note: '',
        }),
      ),
    ).toEqual({ kind: 'failed', code: 'E_BOOK_RESCHEDULE_LIMIT' });
  });
});
