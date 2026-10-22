import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { NoShowResponse } from '@pinehill/contracts';
import type { NoShowBody } from '../src/no-show/model';
import { NoShowWriter, type NoShowPorts } from '../src/no-show/writer';

const body: NoShowBody = { bookingId: 'b1', reason: 'Khách không đến' };
const ok = (over: Partial<NoShowResponse> = {}): NoShowResponse => ({
  bookingId: 'b1',
  status: 'NO_SHOW',
  markedAt: '2026-10-22T17:00:00.000Z',
  penaltyAmount: 1_200_000,
  refundRequestId: null,
  ...over,
});

function setup(over: Partial<NoShowPorts> = {}) {
  let n = 0;
  const send = vi.fn(async (_body: NoShowBody, _key: string) => ok());
  const writer = new NoShowWriter({
    online: async () => true,
    send,
    createId: () => `key-${++n}`,
    ...over,
  });
  return { writer, send };
}

test('sends once with a fresh key and returns the server response', async () => {
  const { writer, send } = setup();
  expect(await writer.submit(body)).toEqual({ kind: 'done', response: ok() });
  expect(send).toHaveBeenCalledWith(body, 'key-1');
  expect(writer.hasPending).toBe(false);
});

test('offline sends nothing and queues nothing', async () => {
  const { writer, send } = setup({ online: async () => false });
  expect(await writer.submit(body)).toEqual({ kind: 'offline' });
  expect(send).not.toHaveBeenCalled();
  expect(writer.hasPending).toBe(false);
});

test('unknown outcome keeps the key for the same body only; a certain rejection clears it', async () => {
  const send = vi
    .fn<(b: NoShowBody, key: string) => Promise<NoShowResponse>>()
    .mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'slow', traceId: 'tr' }))
    .mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'down' }))
    .mockRejectedValueOnce(
      new ApiError({ kind: 'http', status: 409, code: 'E_BOOK_INVALID_STATE', message: 'sớm' }),
    )
    .mockResolvedValue(ok());
  const { writer } = setup({ send });
  const first = await writer.submit(body);
  expect(first).toEqual({ kind: 'failed', failure: { kind: 'unknownOutcome', reference: 'tr' } });
  expect(writer.hasPending).toBe(true);
  await writer.submit(body);
  await writer.submit({ ...body, reason: 'Lý do khác' });
  expect(writer.hasPending).toBe(false);
  await writer.submit({ ...body, reason: 'Lý do khác' });
  expect(send.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1', 'key-2', 'key-3']);
  expect(writer.hasPending).toBe(false);
});

test('a rejected response clears the pending key', async () => {
  const send = vi
    .fn<(b: NoShowBody, key: string) => Promise<NoShowResponse>>()
    .mockRejectedValue(
      new ApiError({ kind: 'http', status: 409, code: 'E_BOOK_INVALID_STATE', message: 'sớm' }),
    );
  const { writer } = setup({ send });
  const outcome = await writer.submit(body);
  expect(outcome).toEqual({
    kind: 'failed',
    failure: { kind: 'rejected', code: 'E_BOOK_INVALID_STATE', status: 409, reason: 'sớm' },
  });
  expect(writer.hasPending).toBe(false);
});

test.each([
  ['another booking', { bookingId: 'zz' }],
  ['a status that is not NO_SHOW', { status: 'CONFIRMED' as const }],
])('a response for %s is an unknown outcome, never success', async (_n, patch) => {
  const { writer } = setup({ send: async () => ok(patch) });
  const outcome = await writer.submit(body);
  expect(outcome.kind === 'failed' && outcome.failure.kind).toBe('unknownOutcome');
  expect(writer.hasPending).toBe(true);
});

test('concurrent submits share one request; reset and dispose behave', async () => {
  let release: () => void = () => undefined;
  const send = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return ok();
  });
  const { writer } = setup({ send });
  const a = writer.submit(body);
  const b = writer.submit(body);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  release();
  expect(await a).toEqual(await b);
  writer.reset();
  writer.dispose();
  expect(await writer.submit(body)).toEqual({ kind: 'closed' });
});
