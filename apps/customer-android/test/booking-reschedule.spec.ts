import { describe, expect, it } from 'vitest';
import { ChangeController } from '../src/booking-changes/controller';
import { fixture, draft, timeout, rescheduledBooking } from './booking-change-fixture';
describe('HB-114 reschedule preview', () => {
  it('reschedule accepts server quote before confirm, freezes accepted quoteId for retry', async () => {
    const f = fixture();
    const quote = {
      quoteId: 'q1',
      channelCode: 'WEB' as const,
      ratePlanCode: 'FLEX7' as const,
      checkIn: '2026-12-25',
      checkOut: '2026-12-27',
      nights: [],
      subtotal: 1900001,
      discountAmount: 0,
      total: 1900001,
      currency: 'VND' as const,
      warnings: [],
      depositPercent: 30,
      depositAmount: 570001,
      engineVersion: 'v1',
      quotedAt: '2026-10-12T00:00:00Z',
      expiresAt: '2026-10-12T00:05:00Z',
    };
    const controller = new ChangeController({
      kind: 'reschedule',
      bookingId: 'b1',
      etag: '"4"',
      api: f.api,
      net: { getConnected: async () => true },
      now: () => Date.parse('2026-10-12T00:01:00Z'),
      createId: () => '11111111-1111-4111-8111-111111111111',
    });
    controller.edit({ ...draft, checkIn: quote.checkIn, checkOut: quote.checkOut });
    f.setPreview({ kind: 'reschedule', data: quote });
    await controller.preview();
    f.setPreview({ kind: 'reschedule', data: { ...quote, quoteId: 'q-fresh' } });
    f.setError(timeout());
    await controller.confirm();
    expect(f.writes[0]?.body).toEqual({
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      quoteId: 'q-fresh',
    });
    await controller.retry();
    expect(f.writes[1]).toEqual(f.writes[0]);
    f.setError(undefined);
    f.api.commit = async () => ({
      kind: 'reschedule',
      data: rescheduledBooking(quote.checkIn, quote.checkOut),
    });
    await controller.retry();
    expect(controller.state.phase).toBe('done');
    expect(controller.state.result).toMatchObject({
      kind: 'reschedule',
      data: { checkIn: quote.checkIn, checkOut: quote.checkOut, rescheduleCount: 1 },
    });
  });
  it('changed quote amount requires reconfirmation; expired or mismatched dates never write', async () => {
    const f = fixture();
    const quote = {
      quoteId: 'q1',
      channelCode: 'WEB' as const,
      ratePlanCode: 'FLEX7' as const,
      checkIn: '2026-12-25',
      checkOut: '2026-12-27',
      nights: [],
      subtotal: 1900001,
      discountAmount: 0,
      total: 1900001,
      currency: 'VND' as const,
      warnings: [],
      depositPercent: 30,
      depositAmount: 570001,
      engineVersion: 'v1',
      quotedAt: '2026-10-12T00:00:00Z',
      expiresAt: '2026-10-12T00:05:00Z',
    };
    const controller = new ChangeController({
      kind: 'reschedule',
      bookingId: 'b1',
      etag: '"4"',
      api: f.api,
      net: { getConnected: async () => true },
      now: () => Date.parse('2026-10-12T00:01:00Z'),
      createId: () => '11111111-1111-4111-8111-111111111111',
    });
    controller.edit({ ...draft, checkIn: quote.checkIn, checkOut: quote.checkOut });
    f.setPreview({ kind: 'reschedule', data: quote });
    await controller.preview();
    f.setPreview({ kind: 'reschedule', data: { ...quote, total: 2000000 } });
    await controller.confirm();
    expect(f.writes).toHaveLength(0);
    expect(controller.state.notice).toBe('changed');
    f.setPreview({ kind: 'reschedule', data: { ...quote, expiresAt: '2026-10-12T00:00:00Z' } });
    await controller.preview();
    expect(controller.state.phase).toBe('editing');
    f.setPreview({ kind: 'reschedule', data: { ...quote, checkOut: '2026-12-28' } });
    await controller.preview();
    expect(controller.state.phase).toBe('editing');
    expect(f.writes).toHaveLength(0);
  });
});
