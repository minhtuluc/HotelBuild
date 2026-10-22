import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { CheckInResponse } from '@pinehill/contracts';
import { CheckInWriter, type CheckInPorts } from '../src/arrivals/writer';
import type { CheckInBody } from '../src/arrivals/model';

const body: CheckInBody = { bookingId: 'b1', actualRoomIds: ['r1'], earlyCheckIn: false };

const ok = (over: Partial<CheckInResponse> = {}): CheckInResponse => ({
  bookingId: 'b1',
  status: 'CHECKED_IN',
  roomIds: ['r1'],
  checkedInAt: '2026-10-22T07:00:00.000Z',
  earlyCheckInFee: 0,
  ...over,
});

function setup(over: Partial<CheckInPorts> = {}) {
  let n = 0;
  const send = vi.fn(async (_body: CheckInBody, _key: string) => ok());
  const ports: CheckInPorts = {
    online: async () => true,
    send,
    createId: () => `key-${++n}`,
    ...over,
  };
  return { writer: new CheckInWriter(ports), send };
}

test('sends the body once with a fresh key and reports the server response', async () => {
  const { writer, send } = setup();
  const outcome = await writer.submit(body);
  expect(outcome).toEqual({ kind: 'done', response: ok() });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(body, 'key-1');
  expect(writer.hasPending).toBe(false);
});

test('offline sends nothing and queues nothing (QĐ-03 decision 6)', async () => {
  const { writer, send } = setup({ online: async () => false });
  expect(await writer.submit(body)).toEqual({ kind: 'offline' });
  expect(send).not.toHaveBeenCalled();
  expect(writer.hasPending).toBe(false);
});

test('a connectivity probe that throws is treated as offline, not as a sent request', async () => {
  const { writer, send } = setup({
    online: async () => {
      throw new Error('probe');
    },
  });
  expect(await writer.submit(body)).toEqual({ kind: 'offline' });
  expect(send).not.toHaveBeenCalled();
});

test('unknown outcome keeps the key: retrying the same body reuses it, a changed body does not', async () => {
  const send = vi
    .fn<(b: CheckInBody, key: string) => Promise<CheckInResponse>>()
    .mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'slow', traceId: 'tr1' }))
    .mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'down' }))
    .mockResolvedValue(ok({ roomIds: ['r2'] }));
  const { writer } = setup({ send });
  const first = await writer.submit(body);
  expect(first).toEqual({ kind: 'failed', failure: { kind: 'unknownOutcome', reference: 'tr1' } });
  expect(writer.hasPending).toBe(true);
  await writer.submit(body);
  const changed = { ...body, actualRoomIds: ['r2'] };
  await writer.submit(changed);
  expect(send.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-1', 'key-2']);
  expect(writer.hasPending).toBe(false);
});

test('a certain rejection clears the pending key so the next attempt is a new intent', async () => {
  const send = vi
    .fn<(b: CheckInBody, key: string) => Promise<CheckInResponse>>()
    .mockRejectedValueOnce(
      new ApiError({
        kind: 'http',
        status: 409,
        code: 'E_FO_CHECKIN_NOT_ALLOWED',
        message: 'Còn nợ',
      }),
    )
    .mockResolvedValue(ok());
  const { writer } = setup({ send });
  const first = await writer.submit(body);
  expect(first).toEqual({
    kind: 'failed',
    failure: { kind: 'rejected', code: 'E_FO_CHECKIN_NOT_ALLOWED', status: 409, reason: 'Còn nợ' },
  });
  expect(writer.hasPending).toBe(false);
  await writer.submit(body);
  expect(send.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-2']);
});

test.each([
  ['another booking', { bookingId: 'zz' }],
  ['a status that is not CHECKED_IN', { status: 'CONFIRMED' as const }],
])('a response for %s is an unknown outcome, never success', async (_name, patch) => {
  const { writer } = setup({ send: async () => ok(patch) });
  const outcome = await writer.submit(body);
  expect(outcome.kind).toBe('failed');
  expect(outcome.kind === 'failed' && outcome.failure.kind).toBe('unknownOutcome');
  expect(writer.hasPending).toBe(true);
});

test('concurrent submits share one request', async () => {
  let release: () => void = () => undefined;
  const send = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return ok();
  });
  const { writer } = setup({ send });
  const first = writer.submit(body);
  const second = writer.submit(body);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  release();
  expect(await first).toEqual(await second);
  expect(send).toHaveBeenCalledTimes(1);
});

test('reset forgets the pending key (session or property changed) and dispose closes the writer', async () => {
  const send = vi
    .fn<(b: CheckInBody, key: string) => Promise<CheckInResponse>>()
    .mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'down' }))
    .mockResolvedValue(ok());
  const { writer } = setup({ send });
  await writer.submit(body);
  expect(writer.hasPending).toBe(true);
  writer.reset();
  expect(writer.hasPending).toBe(false);
  await writer.submit(body);
  expect(send.mock.calls.map((call) => call[1])).toEqual(['key-1', 'key-2']);
  writer.dispose();
  expect(await writer.submit(body)).toEqual({ kind: 'closed' });
  expect(send).toHaveBeenCalledTimes(2);
});
