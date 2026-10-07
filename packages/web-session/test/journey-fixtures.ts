import type { QuoteRequest, BookingCreateRequest, HoldCreateRequest } from '@pinehill/contracts';
export const key = '123e4567-e89b-42d3-a456-426614174079';
export const search: {
  propertyId: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  roomCount: number;
  channelCode: 'WEB';
} = {
  propertyId: 'synthetic-property',
  roomTypeId: 'synthetic-room',
  checkIn: '2026-10-10',
  checkOut: '2026-10-11',
  adults: 2,
  children: 0,
  roomCount: 1,
  channelCode: 'WEB',
};
export const quoteInput: QuoteRequest = { ...search, ratePlanCode: 'FLEX7' };
export const holdInput: HoldCreateRequest = { ...search, quoteId: 'synthetic-quote' };
export const bookingInput: BookingCreateRequest = {
  ...quoteInput,
  quoteId: 'synthetic-quote',
  guest: { fullName: 'Synthetic guest', phone: '+84900000079' },
};
export const availability = {
  checkIn: '2026-10-10',
  checkOut: '2026-10-11',
  nights: 1,
  data: [
    {
      propertyId: 'synthetic-property',
      roomTypeId: 'synthetic-room',
      roomTypeCode: 'STD',
      roomTypeName: 'Synthetic room',
      capacityAdults: 2,
      availableCount: 3,
      soldOut: false,
      minNights: 1,
      maxNights: 30,
      nightlyFrom: 1000000,
      totalFrom: 1000000,
    },
  ],
  meta: { limit: 20, nextCursor: null, hasMore: false },
};
export const plans = {
  data: [
    { code: 'FLEX7', name: 'Synthetic standard', minNights: 1, maxNights: 30, depositPercent: 30 },
  ],
  meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 },
};
export const quote = {
  quoteId: 'synthetic-quote',
  channelCode: 'WEB',
  ratePlanCode: 'FLEX7',
  checkIn: '2026-10-10',
  checkOut: '2026-10-11',
  nights: [
    {
      date: '2026-10-10',
      basePrice: 1000000,
      seasonMultiplier: 1,
      weekendMultiplier: 1,
      occupancyMultiplier: 1,
      losMultiplier: 1,
      channelMultiplier: 1,
      clamped: false,
      nightlyPrice: 1000000,
    },
  ],
  subtotal: 1000000,
  discountAmount: 0,
  total: 1000000,
  currency: 'VND',
  warnings: [],
  depositPercent: 30,
  depositAmount: 300000,
  engineVersion: 'synthetic-v1',
  quotedAt: '2026-10-07T00:00:00.000Z',
  expiresAt: '2026-10-07T00:15:00.000Z',
};
export const hold = {
  holdId: 'synthetic-hold',
  bookingId: 'synthetic-booking',
  bookingCode: 'SYN079',
  bookingStatus: 'HELD',
  status: 'ACTIVE',
  channelId: 'synthetic-web',
  releasedAt: null,
  expiresAt: '2026-10-07T00:15:00.000Z',
  holdExpiresAt: '2026-10-07T00:15:00.000Z',
  quotedTotal: 1000000,
  createdAt: '2026-10-07T00:00:00.000Z',
};
export const booking = {
  id: 'synthetic-booking',
  code: 'SYN079',
  seq: 1,
  status: 'HELD',
  guestId: 'synthetic-guest',
  propertyId: 'synthetic-property',
  roomTypeId: 'synthetic-room',
  ratePlanId: 'synthetic-standard',
  channelId: 'synthetic-web',
  checkIn: '2026-10-10',
  checkOut: '2026-10-11',
  nights: 1,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 1000000,
  depositPercent: 30,
  depositAmount: 300000,
  paidAmount: 0,
  refundedAmount: 0,
  balanceDue: 1000000,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: '2026-10-07T00:15:00.000Z',
  oversold: false,
  priceLocked: false,
  duplicateSuspected: true,
  channelPolicyCode: null,
  note: null,
  createdBy: 'synthetic-guest',
  createdAt: '2026-10-07T00:00:00.000Z',
};
