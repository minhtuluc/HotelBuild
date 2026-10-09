/** Synthetic HTTP fixtures only: these values do not implement production pricing or inventory. */
import type {
  Quote,
  QuoteRequest,
  BookingSummary,
  BookingCreateRequest,
  Hold,
} from '../../../../packages/contracts/src/index.js';
/** Cơ sở công khai cho journey khách — chỉ trường công khai (HB-080, `GET /public/properties`). */
export const publicProperties = [
  {
    id: 'synthetic-property',
    name: 'Synthetic Pine Hill',
    checkInTime: '14:00',
    checkOutTime: '12:00',
  },
];

export const ratePlans = {
  data: [
    { code: 'FLEX7', name: 'Synthetic flexible', minNights: 1, maxNights: 30, depositPercent: 30 },
    { code: 'SAVER3', name: 'Synthetic saver', minNights: 1, maxNights: 30, depositPercent: 30 },
    {
      code: 'NONREF',
      name: 'Synthetic nonrefundable',
      minNights: 1,
      maxNights: 30,
      depositPercent: 30,
    },
    {
      code: 'LONGSTAY14',
      name: 'Synthetic long stay',
      minNights: 1,
      maxNights: 30,
      depositPercent: 30,
    },
  ],
  meta: { limit: 20, nextCursor: null, hasMore: false, total: 4 },
};
export function dates(checkIn: string, checkOut: string): string[] {
  const start = Date.parse(checkIn + 'T00:00:00Z');
  const end = Date.parse(checkOut + 'T00:00:00Z');
  const count = (end - start) / 86400000;
  if (!Number.isInteger(count) || count < 1 || count > 365)
    throw new Error('Unsupported synthetic stay');
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}
export function quoted(input: QuoteRequest): Quote {
  const nights = dates(input.checkIn, input.checkOut).map((date) => ({
    date,
    basePrice: 1000000,
    seasonMultiplier: 1,
    weekendMultiplier: 1,
    occupancyMultiplier: 1,
    losMultiplier: 1,
    channelMultiplier: 1,
    clamped: false,
    nightlyPrice: 1000000,
  }));
  const total = nights.length * input.roomCount * 1000000;
  return {
    quoteId: crypto.randomUUID(),
    channelCode: input.channelCode,
    ratePlanCode: input.ratePlanCode,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights,
    subtotal: total,
    discountAmount: 0,
    total,
    currency: 'VND',
    warnings: [],
    depositPercent: 30,
    depositAmount: (total * 30) / 100,
    engineVersion: 'synthetic-journey-v1',
    quotedAt: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + (input.propertyId === 'journey-expired' ? -1000 : 900000),
    ).toISOString(),
  };
}
export function held(quote: Quote): Hold {
  return {
    holdId: crypto.randomUUID(),
    bookingId: crypto.randomUUID(),
    bookingCode: 'SYN079',
    bookingStatus: 'HELD',
    status: 'ACTIVE',
    channelId: 'synthetic-web',
    releasedAt: null,
    expiresAt: quote.expiresAt,
    holdExpiresAt: quote.expiresAt,
    quotedTotal: quote.total,
    createdAt: new Date().toISOString(),
  };
}
export function booked(input: BookingCreateRequest, quote: Quote): BookingSummary {
  return {
    id: crypto.randomUUID(),
    code: 'SYN079',
    seq: 1,
    status: 'HELD',
    guestId: 'synthetic-guest',
    propertyId: input.propertyId,
    roomTypeId: input.roomTypeId,
    ratePlanId: input.ratePlanCode,
    channelId: 'synthetic-web',
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    nights: quote.nights.length,
    adults: input.adults,
    children: input.children,
    roomCount: input.roomCount,
    totalAmount: quote.total,
    depositPercent: quote.depositPercent,
    depositAmount: quote.depositAmount,
    paidAmount: 0,
    refundedAmount: 0,
    balanceDue: quote.total,
    penaltyAmount: 0,
    currency: 'VND',
    rescheduleCount: 0,
    holdExpiresAt: quote.expiresAt,
    oversold: false,
    priceLocked: false,
    duplicateSuspected: input.propertyId === 'journey-duplicate',
    channelPolicyCode: null,
    note: input.note ?? null,
    createdBy: 'synthetic-guest',
    createdAt: new Date().toISOString(),
  };
}
