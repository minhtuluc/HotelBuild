import { describe, expect, it } from 'vitest';
import { ChangeController } from '../src/booking-changes/controller';
import { fixture, draft } from './booking-change-fixture';
describe('HB-114 reschedule preview', () => {
  it('informational room quote never authorizes reschedule without authoritative final obligations', async () => {
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
    await controller.confirm();
    expect(f.writes).toHaveLength(0);
    expect(controller.state.notice).toBe('feeUnavailable');
    expect(controller.state.phase).toBe('previewed');
  });
  it('informational quote refreshes; expired or mismatched dates never write', async () => {
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
    await controller.preview();
    expect(f.writes).toHaveLength(0);
    expect(controller.state.preview).toMatchObject({ data: { total: 2000000 } });
    f.setPreview({ kind: 'reschedule', data: { ...quote, expiresAt: '2026-10-12T00:00:00Z' } });
    await controller.preview();
    expect(controller.state.phase).toBe('editing');
    f.setPreview({ kind: 'reschedule', data: { ...quote, checkOut: '2026-12-28' } });
    await controller.preview();
    expect(controller.state.phase).toBe('editing');
    expect(f.writes).toHaveLength(0);
  });
});
