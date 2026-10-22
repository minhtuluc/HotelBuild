import { vi } from 'vitest';
import { WalkInFlow, type WalkInPorts } from '../src/walk-in/flow';
import {
  paymentSchema,
  roomTypeSummarySchema,
  walkInResultSchema,
  type Payment,
  type PaymentCreateRequest,
  type PinToken,
  type WalkInRequest,
  type WalkInResult,
} from '@pinehill/contracts';

export const roomType = roomTypeSummarySchema.parse({
  id: 'rt1',
  propertyId: 'p1',
  code: 'DLX',
  capacityAdults: 2,
  capacityChildren: 1,
  basePrice: 1_000_000,
  minPrice: 800_000,
  maxPrice: 1_500_000,
  allowShared: false,
  bedCount: 1,
  version: 0,
});

const bookingJson = {
  id: 'b1',
  code: 'PH-261022-W1',
  seq: 1,
  status: 'PENDING_PAYMENT',
  guestId: 'g1',
  propertyId: 'p1',
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  channelId: 'ch1',
  checkIn: '2026-10-22',
  checkOut: '2026-10-23',
  nights: 1,
  adults: 2,
  children: 0,
  roomCount: 1,
  totalAmount: 3_000_000,
  depositPercent: 30,
  depositAmount: 907_000,
  paidAmount: 0,
  refundedAmount: 0,
  balanceDue: 3_000_000,
  penaltyAmount: 0,
  currency: 'VND',
  rescheduleCount: 0,
  holdExpiresAt: null,
  oversold: false,
  priceLocked: false,
  duplicateSuspected: false,
  channelPolicyCode: null,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-10-22T00:00:00.000Z',
};

export const result = (over: Record<string, unknown> = {}, created = true): WalkInResult =>
  walkInResultSchema.parse({
    created,
    quote: {
      quoteId: 'q1',
      channelCode: 'WALKIN',
      ratePlanCode: 'FLEX7',
      checkIn: '2026-10-22',
      checkOut: '2026-10-23',
      nights: [],
      subtotal: 3_000_000,
      discountAmount: 0,
      total: 3_000_000,
      currency: 'VND',
      warnings: [],
      depositPercent: 30,
      depositAmount: 907_000,
      engineVersion: 'test',
      quotedAt: '2026-10-22T00:00:00.000Z',
      expiresAt: '2026-10-22T01:00:00.000Z',
    },
    booking: { ...bookingJson, ...over },
  });

export const payment: Payment = paymentSchema.parse({
  paymentId: 'pay1',
  bookingId: 'b1',
  type: 'DEPOSIT',
  method: 'CASH',
  amount: 907_000,
  status: 'SUCCEEDED',
  providerTxnId: null,
  paymentUrl: null,
  expiresAt: null,
  paidAt: '2026-10-22T00:01:00.000Z',
  createdAt: '2026-10-22T00:01:00.000Z',
});

export interface Rig {
  flow: WalkInFlow;
  create: ReturnType<typeof vi.fn<(r: WalkInRequest, key: string) => Promise<WalkInResult>>>;
  verify: ReturnType<typeof vi.fn<(pin: string, bookingId: string) => Promise<PinToken>>>;
  pay: ReturnType<typeof vi.fn<(b: PaymentCreateRequest, key: string) => Promise<Payment>>>;
  online: { value: boolean };
  clock: { value: number };
}

export function rig(over: Partial<WalkInPorts> = {}): Rig {
  const online = { value: true };
  const clock = { value: 1_000_000 };
  let n = 0;
  const create = vi.fn<(r: WalkInRequest, key: string) => Promise<WalkInResult>>(async () =>
    result(),
  );
  const verify = vi.fn<(pin: string, bookingId: string) => Promise<PinToken>>(async () => ({
    pinToken: 'pin-token-0123456789',
    expiresAt: new Date(clock.value + 60_000).toISOString(),
  }));
  const pay = vi.fn<(b: PaymentCreateRequest, key: string) => Promise<Payment>>(
    async () => payment,
  );
  const flow = new WalkInFlow({
    online: async () => online.value,
    now: () => clock.value,
    createId: () => `key-${++n}`,
    roomTypes: async () => [roomType],
    createBooking: create,
    verifyPin: verify,
    pay,
    ...over,
  });
  return { flow, create, verify, pay, online, clock };
}

export async function toReview(r: Rig): Promise<void> {
  await r.flow.init('p1', '2026-10-22');
  r.flow.setStay({ roomTypeId: 'rt1' });
  r.flow.next();
  r.flow.setGuest({ fullName: 'Nguyễn Văn A', phone: '0912345678' });
  r.flow.next();
}
