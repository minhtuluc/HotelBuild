import { describe, expect, it } from 'vitest';
import type { BookingSummary, ListPage } from '@pinehill/contracts';
import {
  NO_FILTERS,
  appendPage,
  balanceRows,
  canPay,
  filtersFrom,
  filtersToQuery,
  nextCursorOf,
} from '../../src/app/(guest)/bookings/model';

function page(ids: readonly string[], nextCursor: string | null): ListPage<{ id: string }> {
  return {
    data: ids.map((id) => ({ id })),
    meta: { limit: 20, nextCursor, hasMore: nextCursor !== null, total: ids.length },
  };
}

function booking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id: 'b1',
    code: 'SYN079',
    seq: 1,
    status: 'HELD',
    guestId: 'g1',
    propertyId: 'p1',
    roomTypeId: 'rt1',
    ratePlanId: 'FLEX7',
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
    holdExpiresAt: '2026-12-24T02:00:00.000Z',
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'g1',
    createdAt: '2026-12-23T02:00:00.000Z',
    ...overrides,
  };
}

describe('SCR-09/SCR-10 đơn của tôi (HB-102)', () => {
  it('đọc bộ lọc từ URL và bỏ giá trị trạng thái lạ', () => {
    expect(filtersFrom(new URLSearchParams('status=CONFIRMED&q= SYN079 '))).toEqual({
      status: 'CONFIRMED',
      q: 'SYN079',
    });
    expect(filtersFrom(new URLSearchParams('status=KHONG-CO'))).toEqual({
      status: '',
      q: '',
    });
    expect(filtersFrom(new URLSearchParams())).toEqual(NO_FILTERS);
  });

  it('ghi bộ lọc ra truy vấn, bỏ khoá rỗng', () => {
    expect(filtersToQuery({ status: 'HELD', q: '0912' })).toBe('status=HELD&q=0912');
    expect(filtersToQuery(NO_FILTERS)).toBe('');
    expect(filtersFrom(new URLSearchParams(filtersToQuery({ status: 'HELD', q: '' })))).toEqual({
      status: 'HELD',
      q: '',
    });
  });

  it('nối trang cuộn tiếp và khử trùng theo id', () => {
    const first = appendPage<{ id: string }>([], page(['a', 'b'], 'c1'));
    expect(first.map((item) => item.id)).toEqual(['a', 'b']);
    const second = appendPage(first, page(['b', 'c'], null));
    expect(second.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('con trỏ trang sau chỉ khi máy chủ còn dữ liệu', () => {
    expect(nextCursorOf(page(['a'], 'c1'))).toBe('c1');
    expect(nextCursorOf(page(['a'], null))).toBeNull();
  });

  it('dòng số dư luôn có tổng và còn phải trả, ẩn dòng bằng 0', () => {
    const rows = balanceRows({
      bookingId: 'b1',
      currency: 'VND',
      totalAmount: 2_000_000,
      paidAmount: 0,
      refundedAmount: 0,
      reservedRefundAmount: 0,
      balanceDue: 2_000_000,
    });
    expect(rows.map((row) => row.key)).toEqual(['total', 'due']);
    const withMoney = balanceRows({
      bookingId: 'b1',
      currency: 'VND',
      totalAmount: 2_000_000,
      paidAmount: 600_000,
      refundedAmount: 100_000,
      reservedRefundAmount: 50_000,
      balanceDue: 1_400_000,
    });
    expect(withMoney.map((row) => row.key)).toEqual([
      'total',
      'paid',
      'refunded',
      'reservedRefund',
      'due',
    ]);
  });

  it('chỉ mời thanh toán khi booking còn giữ chỗ, còn nợ và còn hạn giữ', () => {
    expect(canPay(booking())).toBe(true);
    expect(canPay(booking({ status: 'CONFIRMED' }))).toBe(false);
    expect(canPay(booking({ balanceDue: 0 }))).toBe(false);
    expect(canPay(booking({ holdExpiresAt: null }))).toBe(false);
  });
});
