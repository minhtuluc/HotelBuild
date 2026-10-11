import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { ChangeController } from '../src/booking-changes/controller';
import type { ChangeApi } from '../src/booking-changes/types';

import { fixture, draft, timeout, cancellation } from './booking-change-fixture';
describe('HB-114 preview and online-only confirmation', () => {
  it('cannot confirm without a successful preview', async () => {
    const f = fixture();
    await f.controller.confirm();
    expect(f.writes).toHaveLength(0);
    expect(f.controller.state.phase).toBe('editing');
  });
  it('offline blocks preview and confirmation, never writes', async () => {
    const f = fixture();
    f.setOnline(false);
    await f.controller.preview();
    expect(f.calls()).toBe(0);
    expect(f.controller.state.notice).toBe('offline');
    f.setOnline(true);
    await f.controller.preview();
    f.setOnline(false);
    await f.controller.confirm();
    expect(f.writes).toHaveLength(0);
    expect(f.controller.state.phase).toBe('previewed');
  });
  it('rechecks server amounts; changed tier/refund requires explicit second confirmation', async () => {
    const f = fixture();
    await f.controller.preview();
    f.setPreview({
      kind: 'cancel',
      data: {
        ...cancellation,
        cancellation: {
          ...cancellation.cancellation,
          requestedAmount: 300000,
          appliedTierId: 't2',
        },
      },
    });
    await f.controller.confirm();
    expect(f.writes).toHaveLength(0);
    expect(f.controller.state.notice).toBe('changed');
    await f.controller.confirm();
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]?.etag).toBe('"4"');
  });
  it('time passage with identical server money/tier does not force endless reconfirmation', async () => {
    const f = fixture();
    await f.controller.preview();
    f.setPreview({
      kind: 'cancel',
      data: {
        ...cancellation,
        cancellation: { ...cancellation.cancellation, hoursBeforeCheckIn: 179.99 },
      },
    });
    await f.controller.confirm();
    expect(f.writes).toHaveLength(1);
    expect(f.controller.state.phase).toBe('done');
  });
  it('draft edit invalidates preview and keeps submitted body isolated from caller mutation', async () => {
    const f = fixture();
    await f.controller.preview();
    const edited = { ...draft, note: 'synthetic note' };
    f.controller.edit(edited);
    expect(f.controller.state.preview).toBeNull();
    await f.controller.confirm();
    expect(f.writes).toHaveLength(0);
    await f.controller.preview();
    edited.note = 'changed outside';
    await f.controller.confirm();
    expect(f.writes[0]?.body).toMatchObject({ note: 'synthetic note' });
  });
  it('preview failure clears confirmation and reports safe code, never raw server message', async () => {
    const f = fixture();
    f.api.preview = async () => {
      throw new ApiError({
        kind: 'http',
        status: 422,
        code: 'E_GEN_VALIDATION_FAILED',
        message: 'sensitive synthetic',
      });
    };
    await f.controller.preview();
    await f.controller.confirm();
    expect(f.writes).toHaveLength(0);
    expect(f.controller.state.notice).toBe('E_GEN_VALIDATION_FAILED');
    expect(JSON.stringify(f.controller.state)).not.toContain('sensitive');
  });
  it('double tap starts exactly one mutation', async () => {
    const f = fixture();
    await f.controller.preview();
    await Promise.all([f.controller.confirm(), f.controller.confirm()]);
    expect(f.writes).toHaveLength(1);
  });
  it('unknown outcome freezes draft and retries identical key, body and ETag without another preview', async () => {
    const f = fixture();
    await f.controller.preview();
    f.setError(timeout());
    await f.controller.confirm();
    expect(f.controller.state.phase).toBe('unknown');
    const calls = f.calls();
    f.controller.edit({ ...draft, note: 'different' });
    await f.controller.preview();
    f.setError(undefined);
    await f.controller.retry();
    expect(f.writes[1]).toEqual(f.writes[0]);
    expect(f.calls()).toBe(calls);
    expect(f.controller.state.phase).toBe('done');
  });
  it('offline unknown retry retains intent without sending; TTL24h prevents blind replay', async () => {
    const f = fixture();
    await f.controller.preview();
    f.setError(timeout());
    await f.controller.confirm();
    f.setOnline(false);
    await f.controller.retry();
    expect(f.writes).toHaveLength(1);
    expect(f.controller.state.phase).toBe('unknown');
    f.setOnline(true);
    f.setNow(1000 + 86400000);
    await f.controller.retry();
    expect(f.writes).toHaveLength(1);
    expect(f.controller.state.notice).toBe('reconcile');
  });
  it.each([401, 403])(
    'auth/scope rejection %i clears preview and prevents replay',
    async (status) => {
      const f = fixture();
      await f.controller.preview();
      f.setError(
        new ApiError({ kind: 'http', status, code: 'E_RBAC_FORBIDDEN', message: 'synthetic' }),
      );
      await f.controller.confirm();
      expect(f.controller.state.phase).toBe('denied');
      expect(f.controller.state.preview).toBeNull();
      await f.controller.retry();
      expect(f.writes).toHaveLength(1);
    },
  );
  it.each([412, 428])(
    'version rejection %i invalidates preview and requires reloading booking',
    async (status) => {
      const f = fixture();
      await f.controller.preview();
      f.setError(new ApiError({ kind: 'http', status, message: 'synthetic' }));
      await f.controller.confirm();
      expect(f.controller.state.phase).toBe('conflict');
      await f.controller.confirm();
      expect(f.writes).toHaveLength(1);
    },
  );
  it('server 5xx or request-in-progress remains unknown, not a new edit', async () => {
    for (const status of [500, 503, 409]) {
      const f = fixture();
      await f.controller.preview();
      f.setError(
        new ApiError({
          kind: 'http',
          status,
          code: 'E_SYS_REQUEST_IN_PROGRESS',
          message: 'synthetic',
        }),
      );
      await f.controller.confirm();
      expect(f.controller.state.phase).toBe('unknown');
    }
  });
  it('mismatched booking response cannot report success', async () => {
    const f = fixture();
    await f.controller.preview();
    f.api.commit = async () => ({
      kind: 'cancel',
      data: {
        ...cancellation,
        bookingId: 'other',
        status: 'CANCELLED',
        cancelledAt: '2026-10-12T00:00:00Z',
        cancelReason: 'GUEST_REQUEST',
        releasedAssignmentCount: 1,
        refundRequest: null,
      },
    });
    await f.controller.confirm();
    expect(f.controller.state.phase).toBe('unknown');
  });
  it('persists intent before network write and restores identical replay after screen restart', async () => {
    const f = fixture();
    let saved: Parameters<ChangeApi['commit']>[0] | null = null;
    const store = {
      load: async () => saved,
      save: async (intent: NonNullable<typeof saved>) => {
        saved = structuredClone(intent);
      },
      clear: async () => {
        saved = null;
      },
    };
    const options = {
      kind: 'cancel' as const,
      bookingId: 'b1',
      etag: '"4"',
      api: f.api,
      net: { getConnected: async () => true },
      now: () => 1000,
      createId: () => '11111111-1111-4111-8111-111111111111',
      store,
    };
    const first = new ChangeController(options);
    first.edit(draft);
    await first.preview();
    f.setError(timeout());
    await first.confirm();
    expect(saved).not.toBeNull();
    const second = new ChangeController(options);
    await second.restore();
    expect(second.state.phase).toBe('unknown');
    f.setError(undefined);
    await second.retry();
    expect(f.writes[1]).toEqual(f.writes[0]);
    expect(saved).toBeNull();
  });
  it('storage failure prevents write and does not claim success', async () => {
    const f = fixture();
    const controller = new ChangeController({
      kind: 'cancel',
      bookingId: 'b1',
      etag: '"4"',
      api: f.api,
      net: { getConnected: async () => true },
      now: () => 1000,
      createId: () => '11111111-1111-4111-8111-111111111111',
      store: {
        load: async () => null,
        save: async () => {
          throw new Error('synthetic');
        },
        clear: async () => {},
      },
    });
    controller.edit(draft);
    await controller.preview();
    await controller.confirm();
    expect(f.writes).toHaveLength(0);
    expect(controller.state.phase).not.toBe('done');
  });
  it('definitive version rejection clears persisted intent so reload can create a fresh preview', async () => {
    const f = fixture();
    let saved: Parameters<ChangeApi['commit']>[0] | null = null;
    const store = {
      load: async () => saved,
      save: async (intent: NonNullable<typeof saved>) => {
        saved = structuredClone(intent);
      },
      clear: async () => {
        saved = null;
      },
    };
    const controller = new ChangeController({
      kind: 'cancel',
      bookingId: 'b1',
      etag: '"4"',
      api: f.api,
      net: { getConnected: async () => true },
      now: () => 1000,
      createId: () => '11111111-1111-4111-8111-111111111111',
      store,
    });
    controller.edit(draft);
    await controller.preview();
    f.setError(new ApiError({ kind: 'http', status: 412, message: 'synthetic' }));
    await controller.confirm();
    expect(saved).toBeNull();
    expect(controller.state.phase).toBe('conflict');
  });
  it('unsafe server money or wrong booking preview disables confirmation', async () => {
    for (const data of [
      { ...cancellation, bookingId: 'other' },
      {
        ...cancellation,
        cancellation: { ...cancellation.cancellation, paidAmount: Number.MAX_SAFE_INTEGER + 1 },
      },
    ]) {
      const f = fixture();
      f.setPreview({ kind: 'cancel', data });
      await f.controller.preview();
      expect(f.controller.state.phase).toBe('editing');
      await f.controller.confirm();
      expect(f.writes).toHaveLength(0);
    }
  });
});
