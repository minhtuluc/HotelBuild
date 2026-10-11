import { describe, expect, it } from 'vitest';
import { intentStore } from '../src/booking-changes/intent-store';
import { memoryStorage } from '../src/storage';
import { ChangeController } from '../src/booking-changes/controller';
import { ApiError } from '@pinehill/api-client';
import { fixture, draft, cancellation } from './booking-change-fixture';

describe('HB-114 secure intent boundary', () => {
  const intent = {
    kind: 'cancel' as const,
    bookingId: 'b1',
    etag: '"4"',
    key: '11111111-1111-4111-8111-111111111111',
    createdAt: 1000,
    body: { reason: 'GUEST_REQUEST' as const, isForceMajeure: false },
  };
  it('roundtrips exact bytes and isolates guest, booking and action', async () => {
    const storage = memoryStorage();
    const store = intentStore(storage, 'g1', 'b1', 'cancel');
    await store.save(intent);
    expect(await store.load()).toEqual(intent);
    expect(await intentStore(storage, 'g2', 'b1', 'cancel').load()).toBeNull();
    expect(await intentStore(storage, 'g1', 'b2', 'cancel').load()).toBeNull();
    expect(await intentStore(storage, 'g1', 'b1', 'reschedule').load()).toBeNull();
    await store.clear();
    expect(await store.load()).toBeNull();
  });
  it('corrupt binding/UUID/time or stored PIN fails closed instead of creating a new key', async () => {
    const storage = memoryStorage();
    const store = intentStore(storage, 'g1', 'b1', 'cancel');
    for (const bad of [
      { ...intent, bookingId: 'other' },
      { ...intent, key: 'bad' },
      { ...intent, createdAt: -1 },
      { ...intent, pinToken: 'synthetic' },
      { ...intent, body: { ...intent.body, pinToken: 'synthetic' } },
    ]) {
      await storage.set('booking-change.v1.g1.b1.cancel', JSON.stringify(bad));
      await expect(store.load()).rejects.toThrow();
    }
  });
  it('Retry-After delays unknown replay without changing the frozen intent', async () => {
    const f = fixture();
    await f.controller.preview();
    f.setError(
      new ApiError({
        kind: 'http',
        status: 409,
        code: 'E_SYS_REQUEST_IN_PROGRESS',
        retryAfterSeconds: 30,
        message: 'synthetic',
      }),
    );
    await f.controller.confirm();
    await f.controller.retry();
    expect(f.writes).toHaveLength(1);
    f.setNow(31000);
    f.setError(undefined);
    await f.controller.retry();
    expect(f.writes).toHaveLength(2);
    expect(f.writes[0]).toEqual(f.writes[1]);
  });
  it('cancel response in original state never claims a completed cancellation', async () => {
    const f = fixture();
    await f.controller.preview();
    f.api.commit = async () => ({
      kind: 'cancel',
      data: {
        ...cancellation,
        status: 'CONFIRMED',
        cancelledAt: '2026-10-12T00:00:00Z',
        cancelReason: 'GUEST_REQUEST',
        releasedAssignmentCount: 0,
        refundRequest: null,
      },
    });
    await f.controller.confirm();
    expect(f.controller.state.phase).toBe('unknown');
  });
  it('authorization denial remains denied even when persisted-intent cleanup fails', async () => {
    const f = fixture();
    const controller = new ChangeController({
      kind: 'cancel',
      bookingId: 'b1',
      etag: '"4"',
      api: f.api,
      net: { getConnected: async () => true },
      now: () => 1000,
      createId: () => intent.key,
      store: {
        load: async () => null,
        save: async () => {},
        clear: async () => {
          throw new Error('synthetic');
        },
      },
    });
    controller.edit(draft);
    await controller.preview();
    f.setError(new ApiError({ kind: 'http', status: 403, message: 'synthetic' }));
    await controller.confirm();
    expect(controller.state.phase).toBe('denied');
    expect(controller.state.notice).toBe('forbidden');
    expect(controller.state.preview).toBeNull();
  });
  it('preserves confirmed server receipt if local cleanup fails', async () => {
    const f = fixture();
    const controller = new ChangeController({
      kind: 'cancel',
      bookingId: 'b1',
      etag: '"4"',
      api: f.api,
      net: { getConnected: async () => true },
      now: () => 1000,
      createId: () => intent.key,
      store: {
        load: async () => null,
        save: async () => {},
        clear: async () => {
          throw new Error('synthetic');
        },
      },
    });
    controller.edit(draft);
    await controller.preview();
    await controller.confirm();
    expect(controller.state.phase).toBe('done');
    expect(controller.state.notice).toBe('storage');
  });
});
