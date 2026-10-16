import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BookingSummary } from '@pinehill/contracts';
import {
  ConfirmationBlock,
  StayTable,
} from '../../src/app/(guest)/booking/[bookingId]/booking-result-screen';

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

function heldBooking(): BookingSummary {
  return {
    id: 'booking-scr07',
    code: 'SYN000001',
    seq: 1,
    status: 'HELD',
    guestId: 'guest-1',
    propertyId: 'synthetic-property',
    roomTypeId: 'synthetic-room',
    ratePlanId: 'rate-flex7',
    channelId: 'channel-direct',
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
    holdExpiresAt: '2026-12-24T10:15:00.000Z',
    oversold: false,
    priceLocked: true,
    duplicateSuspected: false,
    channelPolicyCode: null,
    note: null,
    createdBy: 'guest-1',
    createdAt: '2026-12-24T10:00:00.000Z',
  };
}

describe('SCR-07 kỳ ở màn kết quả giữ chỗ (HB-083)', () => {
  it('bảng kỳ ở hiện ngày lịch dd/MM/yyyy, không còn ISO nguyên văn', () => {
    const html = renderToStaticMarkup(createElement(StayTable, { booking: heldBooking() }));
    expect(html).toContain('24/12/2026 → 26/12/2026 · 2 đêm · 2 người lớn · 0 trẻ em');
    expect(html).not.toMatch(ISO_DATE);
  });

  it('khối xác nhận hiện kỳ ở dd/MM/yyyy, không còn ISO nguyên văn', () => {
    const html = renderToStaticMarkup(createElement(ConfirmationBlock, { booking: heldBooking() }));
    expect(html).toContain('24/12/2026 → 26/12/2026 · 2 đêm · 2 người lớn · 0 trẻ em');
    expect(html).not.toMatch(ISO_DATE);
  });
});
