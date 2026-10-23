import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { NoShowPreview } from '@pinehill/contracts';
import { OfflineError } from '../src/netinfo';
import { PreviewReader } from '../src/preview/reader';

const preview = (over: Partial<NoShowPreview> = {}): NoShowPreview => ({
  bookingId: 'b1',
  penaltyAmount: 600_000,
  expectedRefundAmount: 0,
  markableFrom: '2026-10-22T16:59:00.000Z',
  computedAt: '2026-10-22T09:40:00.000Z',
  ...over,
});

test('starts idle, shows loading with no value, then the server numbers', async () => {
  const reader = new PreviewReader<NoShowPreview>();
  expect(reader.state).toEqual({ phase: 'idle', value: null });
  const seen: string[] = [];
  reader.subscribe(() => seen.push(reader.state.phase));
  await reader.load('b1', async () => preview());
  expect(seen).toEqual(['loading', 'ready']);
  expect(reader.state.value?.penaltyAmount).toBe(600_000);
});

test('a reload drops the previous numbers at once: money is never carried over while loading', async () => {
  const reader = new PreviewReader<NoShowPreview>();
  await reader.load('b1', async () => preview());
  let release: () => void = () => undefined;
  const pending = reader.load('b1', async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return preview({ penaltyAmount: 0 });
  });
  expect(reader.state).toEqual({ phase: 'loading', value: null });
  release();
  await pending;
  expect(reader.state.value?.penaltyAmount).toBe(0);
});

test.each([
  ['an OfflineError', new OfflineError(), 'offline'],
  ['a network failure', new ApiError({ kind: 'network', message: 'down' }), 'offline'],
  ['HTTP 401', new ApiError({ kind: 'http', status: 401, code: 'E', message: 'x' }), 'expired'],
  ['HTTP 403', new ApiError({ kind: 'http', status: 403, code: 'E', message: 'x' }), 'forbidden'],
  ['HTTP 409', new ApiError({ kind: 'http', status: 409, code: 'E', message: 'x' }), 'error'],
  ['a random throw', new Error('boom'), 'error'],
] as const)('%s ends with no value and the matching phase', async (_name, failure, phase) => {
  const reader = new PreviewReader<NoShowPreview>();
  await reader.load('b1', async () => preview());
  await reader.load('b1', async () => {
    throw failure;
  });
  expect(reader.state).toEqual({ phase, value: null });
});

test('a response for another booking is an error, never shown', async () => {
  const reader = new PreviewReader<NoShowPreview>();
  await reader.load('b1', async () => preview({ bookingId: 'other' }));
  expect(reader.state).toEqual({ phase: 'error', value: null });
});

test('a late response from an older load never overwrites the newest one', async () => {
  const reader = new PreviewReader<NoShowPreview>();
  const gates: Array<() => void> = [];
  const slow = (penalty: number) => async () => {
    await new Promise<void>((resolve) => gates.push(resolve));
    return preview({ penaltyAmount: penalty });
  };
  const first = reader.load('b1', slow(1));
  const second = reader.load('b1', slow(2));
  gates[1]!();
  await second;
  gates[0]!();
  await first;
  expect(reader.state.value?.penaltyAmount).toBe(2);
});

test('invalidate returns to idle and drops the in-flight result; dispose silences listeners', async () => {
  const reader = new PreviewReader<NoShowPreview>();
  const listener = vi.fn();
  reader.subscribe(listener);
  let release: () => void = () => undefined;
  const pending = reader.load('b1', async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return preview();
  });
  reader.invalidate();
  release();
  await pending;
  expect(reader.state).toEqual({ phase: 'idle', value: null });
  reader.dispose();
  listener.mockClear();
  await reader.load('b1', async () => preview());
  expect(listener).not.toHaveBeenCalled();
});
