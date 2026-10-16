import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BookingSummary } from '@pinehill/contracts';
import { stayText } from '../../src/app/(guest)/bookings/model';
import { StayPanel } from '../../src/app/(guest)/bookings/[bookingId]/booking-detail-screen';

// Màn chi tiết dùng `useParams`; ở đây chỉ dựng markup tĩnh nên chỉ cần module nạp được.
vi.mock('next/navigation', () => ({ useParams: () => ({ bookingId: 'b1' }) }));

const ISO_DAY = /\d{4}-\d{2}-\d{2}/;

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

describe('SCR-09/SCR-10 ngày lịch hiển thị dd/MM/yyyy (HB-102)', () => {
  it('kỳ lưu trú đổi ngày lịch sang dd/MM/yyyy, giữ nguyên câu chữ và dấu phân cách', () => {
    const text = stayText(booking());
    expect(text).toBe('24/12/2026 → 26/12/2026 · 2 đêm · 2 người lớn · 0 trẻ em');
    expect(text).not.toMatch(ISO_DAY);
  });

  it('kỳ lưu trú ở năm khác cũng dựng đúng dd/MM/yyyy', () => {
    expect(stayText(booking({ checkIn: '2027-01-01', checkOut: '2027-01-03', nights: 2 }))).toBe(
      '01/01/2027 → 03/01/2027 · 2 đêm · 2 người lớn · 0 trẻ em',
    );
  });

  it('bảng kỳ lưu trú của màn chi tiết hiện dd/MM/yyyy và không còn ISO nguyên văn', () => {
    const html = renderToStaticMarkup(createElement(StayPanel, { booking: booking(), hold: null }));
    expect(html).toContain('data-testid="booking-detail-stay"');
    expect(html).toContain('24/12/2026 → 26/12/2026 · 2 đêm · 2 người lớn · 0 trẻ em');
    expect(html).not.toContain('2026-12-24');
    expect(html).not.toMatch(ISO_DAY);
  });
});
