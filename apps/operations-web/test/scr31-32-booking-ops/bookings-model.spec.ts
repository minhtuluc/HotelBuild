import { describe, expect, it } from 'vitest';
import type { BookingSummary, ListPage } from '@pinehill/contracts';
import {
  NO_FILTERS,
  appendBookings,
  balanceRows,
  canHardDelete,
  filtersFrom,
  filtersToQuery,
  listQuery,
  nextCursorOf,
  stayOf,
} from '../../src/app/(ops)/bookings/bookings-model';

function booking(id: string): BookingSummary {
  return {
    id,
    code: `SYN-${id}`,
    seq: 1,
    status: 'DRAFT',
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
    paidAmount: 0,
    refundedAmount: 0,
    balanceDue: 2_000_000,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: null,
    oversold: false,
    priceLocked: false,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'staff',
    createdAt: '2026-12-01T00:00:00.000Z',
  };
}

function page(ids: readonly string[], nextCursor: string | null): ListPage<BookingSummary> {
  return {
    data: ids.map(booking),
    meta: { limit: 20, nextCursor, hasMore: nextCursor !== null, total: ids.length },
  };
}

describe('SCR-31/SCR-32 danh sách & chi tiết booking (HB-106)', () => {
  it('đọc bộ lọc từ URL và bỏ trạng thái lạ', () => {
    expect(
      filtersFrom(
        new URLSearchParams('propertyId=p1&status=HELD&channelCode=WEB&q= PH-123 &from=2026-12-01'),
      ),
    ).toEqual({
      propertyId: 'p1',
      status: 'HELD',
      channelCode: 'WEB',
      q: 'PH-123',
      from: '2026-12-01',
      to: '',
    });
    expect(filtersFrom(new URLSearchParams('status=KHONG-CO'))).toEqual(NO_FILTERS);
  });

  it('ghi bộ lọc ra truy vấn và đọc lại được đúng giá trị', () => {
    const filters = { ...NO_FILTERS, status: 'DRAFT' as const, q: '0912', to: '2026-12-31' };
    expect(filtersFrom(new URLSearchParams(filtersToQuery(filters)))).toEqual(filters);
    expect(filtersToQuery(NO_FILTERS)).toBe('');
  });

  it('dựng truy vấn danh sách: chỉ khoá hợp đồng và chỉ khi có giá trị', () => {
    expect(listQuery(NO_FILTERS, 20, null)).toEqual({ limit: 20 });
    expect(listQuery({ ...NO_FILTERS, status: 'HELD', q: 'PH-1' }, 20, 'c1')).toEqual({
      limit: 20,
      status: 'HELD',
      q: 'PH-1',
      cursor: 'c1',
    });
  });

  it('nối trang theo con trỏ và khử trùng dòng', () => {
    const first = appendBookings([], page(['b1', 'b2'], 'c1'));
    expect(first.map((booking) => booking.id)).toEqual(['b1', 'b2']);
    expect(appendBookings(first, page(['b2', 'b3'], null)).map((booking) => booking.id)).toEqual([
      'b1',
      'b2',
      'b3',
    ]);
    expect(nextCursorOf(page(['b1'], 'c1'))).toBe('c1');
    expect(nextCursorOf(page(['b1'], null))).toBeNull();
  });

  it('chỉ DRAFT/HELD mới hiện lối xoá cứng (BR-BOOK-17/14)', () => {
    expect(canHardDelete('DRAFT')).toBe(true);
    expect(canHardDelete('HELD')).toBe(true);
    for (const status of [
      'PENDING_PAYMENT',
      'CONFIRMED',
      'CHECKED_IN',
      'CHECKED_OUT',
      'CANCELLED',
      'NO_SHOW',
      'EXPIRED',
    ] as const) {
      expect(canHardDelete(status)).toBe(false);
    }
  });

  it('dòng tiền và kỳ lưu trú lấy nguyên số máy chủ trả', () => {
    expect(balanceRows({ paidAmount: 600_000, balanceDue: 1_400_000 })).toEqual([
      { key: 'paid', amount: 600_000 },
      { key: 'balance', amount: 1_400_000 },
    ]);
    expect(stayOf({ checkIn: '2026-12-24', checkOut: '2026-12-26', nights: 2, roomCount: 1 })).toBe(
      '24/12/2026 → 26/12/2026 · 2 đêm · 1 phòng',
    );
  });

  it('ngày lịch hiện dd/MM/yyyy, không đổi sang instant/múi giờ', () => {
    // Mốc đầu năm: hiểu nhầm thành instant UTC rồi đổi múi giờ sẽ lệch về 31/12/2026.
    expect(stayOf({ checkIn: '2027-01-01', checkOut: '2027-01-02', nights: 1, roomCount: 1 })).toBe(
      '01/01/2027 → 02/01/2027 · 1 đêm · 1 phòng',
    );
  });

  it('số đêm và số phòng ít/nhiều đều lấy nguyên số máy chủ trả', () => {
    expect(
      stayOf({ checkIn: '2026-12-24', checkOut: '2026-12-27', nights: 3, roomCount: 12 }),
    ).toBe('24/12/2026 → 27/12/2026 · 3 đêm · 12 phòng');
  });
});
