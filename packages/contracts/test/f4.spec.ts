/**
 * HB-070: hợp đồng F4 khớp ví dụ api.md §3.1/§3.2/§3.4/§3.8 và mã lỗi gắn đúng HTTP §4.2.
 * Mỗi khối JSON dưới đây chép nguyên từ tài liệu để lệch hợp đồng bị phát hiện.
 */
import { describe, expect, it } from 'vitest';
import { availabilityQuerySchema, availabilitySchema } from '../src/inventory.js';
import {
  bookingCreateRequestSchema,
  bookingSummarySchema,
  holdCreateRequestSchema,
  holdSchema,
} from '../src/booking.js';
import { quoteRequestSchema, quoteSchema } from '../src/quote.js';
import { errorCatalogue } from '../src/errors.js';

const QUOTE_REQUEST = {
  propertyId: '8f2a1c40-1a2b-4c3d-8e4f-000000000001',
  roomTypeId: 'b1d9c7e2-1a2b-4c3d-8e4f-000000000002',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  adults: 2,
  children: 0,
  roomCount: 1,
  promotionCodes: ['EARLY10'],
};

const QUOTE_RESPONSE = {
  quoteId: '3c7f9b21-1a2b-4c3d-8e4f-000000000003',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  nights: [
    {
      date: '2026-12-24',
      basePrice: 650000,
      seasonMultiplier: 2.0,
      weekendMultiplier: 1.0,
      occupancyMultiplier: 1.15,
      losMultiplier: 0.95,
      channelMultiplier: 1.0,
      clamped: false,
      nightlyPrice: 1421000,
    },
    {
      date: '2026-12-25',
      basePrice: 650000,
      seasonMultiplier: 2.0,
      weekendMultiplier: 1.2,
      occupancyMultiplier: 1.15,
      losMultiplier: 0.95,
      channelMultiplier: 1.0,
      clamped: false,
      nightlyPrice: 1705000,
    },
  ],
  subtotal: 4831000,
  discountAmount: 483100,
  total: 4348000,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 1305000,
  engineVersion: 'pricing-1.0.0',
  quotedAt: '2026-09-19T03:12:44Z',
  expiresAt: '2026-09-19T03:27:44Z',
};

const BOOKING_REQUEST = {
  propertyId: '8f2a1c40-1a2b-4c3d-8e4f-000000000001',
  roomTypeId: 'b1d9c7e2-1a2b-4c3d-8e4f-000000000002',
  ratePlanCode: 'FLEX7',
  channelCode: 'WEB',
  quoteId: '3c7f9b21-1a2b-4c3d-8e4f-000000000003',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  adults: 2,
  children: 0,
  roomCount: 1,
  promotionCodes: ['EARLY10'],
  guest: { fullName: 'Nguyễn Văn A', phone: '0901234567' },
  note: 'Khách đến muộn sau 22:00',
};

const BOOKING_RESPONSE = {
  id: 'a71c0d34-1a2b-4c3d-8e4f-000000000004',
  code: 'PH-260919-K7M2Q',
  seq: 1042,
  status: 'HELD',
  guestId: '4e8b1f77-1a2b-4c3d-8e4f-000000000005',
  propertyId: '8f2a1c40-1a2b-4c3d-8e4f-000000000001',
  roomTypeId: 'b1d9c7e2-1a2b-4c3d-8e4f-000000000002',
  ratePlanId: 'd5a7e9b3-1a2b-4c3d-8e4f-000000000006',
  channelId: 'c34a9e51-1a2b-4c3d-8e4f-000000000007',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  nights: 3,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 4348000,
  depositPercent: 30,
  depositAmount: 1305000,
  paidAmount: 0,
  refundedAmount: 0,
  balanceDue: 4348000,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: '2026-09-19T03:34:02Z',
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: 'Khách đến muộn sau 22:00',
  createdBy: '7f1d5b90-1a2b-4c3d-8e4f-000000000008',
  createdAt: '2026-09-19T03:14:02Z',
};

const HOLD_REQUEST = {
  propertyId: '8f2a1c40-1a2b-4c3d-8e4f-000000000001',
  roomTypeId: 'b1d9c7e2-1a2b-4c3d-8e4f-000000000002',
  channelCode: 'WEB',
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  adults: 2,
  children: 0,
  roomCount: 1,
  quoteId: '3c7f9b21-1a2b-4c3d-8e4f-000000000003',
};

const HOLD_RESPONSE = {
  holdId: 'e07b3c55-1a2b-4c3d-8e4f-000000000009',
  bookingId: 'f13a8d6c-1a2b-4c3d-8e4f-00000000000a',
  bookingCode: 'PH-260919-R4T8X',
  bookingStatus: 'HELD',
  status: 'ACTIVE',
  channelId: '1a2b3c4d-1a2b-4c3d-8e4f-00000000000b',
  releasedAt: null,
  expiresAt: '2026-09-19T03:34:02Z',
  holdExpiresAt: '2026-09-19T03:34:02Z',
  quotedTotal: 4348000,
  createdAt: '2026-09-19T03:14:02Z',
};

const AVAILABILITY_RESPONSE = {
  checkIn: '2026-12-24',
  checkOut: '2026-12-27',
  nights: 3,
  channelCode: 'WEB',
  data: [
    {
      propertyId: '8f2a1c40-1a2b-4c3d-8e4f-000000000001',
      roomTypeId: 'b1d9c7e2-1a2b-4c3d-8e4f-000000000002',
      roomTypeCode: 'STD',
      roomTypeName: 'Standard',
      capacityAdults: 2,
      availableCount: 4,
      soldOut: false,
      minNights: 1,
      maxNights: 30,
      nightlyFrom: 1421000,
      totalFrom: 4347000,
    },
  ],
  meta: { limit: 20, nextCursor: null, hasMore: false },
};

describe('hợp đồng F4 khớp ví dụ api.md', () => {
  it('§3.1 quote: nhận request và response, giữ số nguyên VND từng đêm', () => {
    expect(quoteRequestSchema.safeParse(QUOTE_REQUEST).success).toBe(true);
    const parsed = quoteSchema.parse(QUOTE_RESPONSE);
    expect(parsed.nights).toHaveLength(2);
    expect(parsed.nights[0]?.nightlyPrice).toBe(1_421_000);
    expect(Number.isInteger(parsed.total)).toBe(true);
  });

  it('§3.2 booking: nhận request (SĐT khách tự nhập) và response HELD', () => {
    expect(bookingCreateRequestSchema.safeParse(BOOKING_REQUEST).success).toBe(true);
    const parsed = bookingSummarySchema.parse(BOOKING_RESPONSE);
    expect(parsed.status).toBe('HELD');
    expect(parsed.channelPolicyCode).toBeNull();
  });

  it('§3.4 hold: nhận request và response, trạng thái hold ACTIVE', () => {
    expect(holdCreateRequestSchema.safeParse(HOLD_REQUEST).success).toBe(true);
    expect(holdSchema.parse(HOLD_RESPONSE).status).toBe('ACTIVE');
  });

  it('§3.8 availability: nhận query và response kèm meta phân trang', () => {
    expect(
      availabilityQuerySchema.safeParse({
        propertyId: '8f2a1c40-1a2b-4c3d-8e4f-000000000001',
        checkIn: '2026-12-24',
        checkOut: '2026-12-27',
        adults: '2',
        children: '0',
        roomCount: '1',
        channelCode: 'WEB',
      }).success,
    ).toBe(true);
    expect(availabilitySchema.parse(AVAILABILITY_RESPONSE).data[0]?.availableCount).toBe(4);
  });

  it('từ chối trường lạ ở request (mass assignment) và kỳ lưu trú không hợp lệ', () => {
    expect(quoteRequestSchema.safeParse({ ...QUOTE_REQUEST, price: 1 }).success).toBe(false);
    expect(
      availabilityQuerySchema.safeParse({
        propertyId: 'p',
        checkIn: '2026-12-27',
        checkOut: '2026-12-24',
        adults: 2,
        children: 0,
        roomCount: 1,
      }).success,
    ).toBe(false);
  });

  it('childAges phải đúng số trẻ em khi khai', () => {
    expect(
      quoteRequestSchema.safeParse({ ...QUOTE_REQUEST, children: 1, childAges: [7] }).success,
    ).toBe(true);
    expect(
      quoteRequestSchema.safeParse({ ...QUOTE_REQUEST, children: 1, childAges: [] }).success,
    ).toBe(false);
  });
});

describe('mã lỗi F4 gắn đúng HTTP §4.2 (HB-070 AC2)', () => {
  it.each([
    ['E_RATE_QUOTE_EXPIRED', 410],
    ['E_RATE_QUOTE_MISMATCH', 409],
    ['E_BOOK_BLACKLISTED', 403],
    ['E_INV_NO_AVAILABILITY', 409],
    ['E_INV_ROOM_TAKEN', 409],
    ['E_INV_LOCK_TIMEOUT', 409],
  ] as const)('%s → %i', (code, status) => {
    expect(errorCatalogue[code].httpStatus).toBe(status);
  });
});
