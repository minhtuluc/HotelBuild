import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { PinnedWriter, type PinnedPorts } from '../src/stay/writer';

interface Body {
  bookingId: string;
  amount: number;
}
interface Res {
  bookingId: string;
  ok: true;
}
const body: Body = { bookingId: 'b1', amount: 5 };
const http = (
  status: number,
  code: string,
  extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
) => new ApiError({ kind: 'http', status, code, message: 'm', ...extra });

function setup(over: Partial<PinnedPorts<Body, Res>> = {}) {
  let n = 0;
  const send = vi.fn(async (_b: Body, _token: string, _key: string): Promise<Res> => ({
    bookingId: 'b1',
    ok: true,
  }));
  const verifyPin = vi.fn(async (_pin: string, _id: string) => 'pin-token-0123456789');
  const ports: PinnedPorts<Body, Res> = {
    online: async () => true,
    verifyPin,
    send,
    createId: () => `key-${++n}`,
    matches: (b, r) => r.bookingId === b.bookingId,
    ...over,
  };
  return { writer: new PinnedWriter(ports), send, verifyPin };
}

test('submit without an unlocked PIN sends nothing', async () => {
  const { writer, send } = setup();
  expect(await writer.submit(body)).toEqual({ kind: 'pinRequired' });
  expect(send).not.toHaveBeenCalled();
});

test('unlock binds the PIN to the booking and holds the token only inside the writer', async () => {
  const { writer, verifyPin } = setup();
  expect(await writer.unlock('123456', 'b1')).toEqual({ kind: 'unlocked' });
  expect(verifyPin).toHaveBeenCalledWith('123456', 'b1');
  expect(writer.unlocked).toBe(true);
});

test('submit sends the token once with a fresh key, then the PIN is spent', async () => {
  const { writer, send } = setup();
  await writer.unlock('123456', 'b1');
  expect(await writer.submit(body)).toEqual({
    kind: 'done',
    response: { bookingId: 'b1', ok: true },
  });
  expect(send).toHaveBeenCalledWith(body, 'pin-token-0123456789', 'key-1');
  expect(writer.unlocked).toBe(false);
  expect(await writer.submit(body)).toEqual({ kind: 'pinRequired' });
});

test.each([
  ['wrong', http(401, 'E_AUTH_PIN_REQUIRED'), { kind: 'wrong' }],
  ['wrong', http(401, 'E_AUTH_INVALID_CREDENTIALS'), { kind: 'wrong' }],
  [
    'locked',
    http(423, 'E_AUTH_PIN_LOCKED', { retryAfterSeconds: 60 }),
    { kind: 'locked', retryAfterSeconds: 60 },
  ],
  ['unavailable', http(500, 'E_SYS_INTERNAL'), { kind: 'unavailable' }],
])('unlock failure (%s) keeps the writer locked', async (_n, error, expected) => {
  const { writer } = setup({
    verifyPin: async () => {
      throw error;
    },
  });
  expect(await writer.unlock('123456', 'b1')).toEqual(expected);
  expect(writer.unlocked).toBe(false);
});

test('offline: neither unlock nor submit reaches the network and nothing is queued', async () => {
  const { writer, send, verifyPin } = setup({ online: async () => false });
  expect(await writer.unlock('123456', 'b1')).toEqual({ kind: 'offline' });
  expect(verifyPin).not.toHaveBeenCalled();
  const online = setup();
  await online.writer.unlock('123456', 'b1');
  let up = true;
  const gated = setup({ online: async () => up });
  await gated.writer.unlock('123456', 'b1');
  up = false;
  expect(await gated.writer.submit(body)).toEqual({ kind: 'offline' });
  expect(gated.send).not.toHaveBeenCalled();
  expect(gated.writer.unlocked).toBe(true);
  expect(send).not.toHaveBeenCalled();
});

test('unknown outcome keeps token and key: the retry replays the same request', async () => {
  const send = vi
    .fn<(b: Body, t: string, k: string) => Promise<Res>>()
    .mockRejectedValueOnce(new ApiError({ kind: 'timeout', message: 'slow', traceId: 'tr' }))
    .mockResolvedValue({ bookingId: 'b1', ok: true });
  const { writer } = setup({ send });
  await writer.unlock('123456', 'b1');
  const first = await writer.submit(body);
  expect(first).toEqual({ kind: 'failed', failure: { kind: 'unknownOutcome', reference: 'tr' } });
  expect(writer.unlocked).toBe(true);
  expect((await writer.submit(body)).kind).toBe('done');
  expect(send.mock.calls.map((c) => [c[1], c[2]])).toEqual([
    ['pin-token-0123456789', 'key-1'],
    ['pin-token-0123456789', 'key-1'],
  ]);
});

test('a definite rejection spends the PIN and the next attempt is a new intent', async () => {
  const send = vi
    .fn<(b: Body, t: string, k: string) => Promise<Res>>()
    .mockRejectedValueOnce(http(422, 'E_PAY_AMOUNT_MISMATCH'))
    .mockResolvedValue({ bookingId: 'b1', ok: true });
  const { writer } = setup({ send });
  await writer.unlock('123456', 'b1');
  const first = await writer.submit(body);
  expect(first).toMatchObject({ kind: 'failed', failure: { kind: 'rejected', status: 422 } });
  expect(writer.unlocked).toBe(false);
  await writer.unlock('123456', 'b1');
  await writer.submit(body);
  expect(send.mock.calls.map((c) => c[2])).toEqual(['key-1', 'key-2']);
});

test('the server refusing the token asks for the PIN again', async () => {
  const { writer } = setup({
    send: async () => {
      throw http(401, 'E_AUTH_PIN_REQUIRED');
    },
  });
  await writer.unlock('123456', 'b1');
  expect(await writer.submit(body)).toEqual({ kind: 'pinRequired' });
  expect(writer.unlocked).toBe(false);
});

test('a response for another booking is an unknown outcome, never success', async () => {
  const { writer } = setup({ send: async () => ({ bookingId: 'zz', ok: true }) });
  await writer.unlock('123456', 'b1');
  const outcome = await writer.submit(body);
  expect(outcome).toEqual({ kind: 'failed', failure: { kind: 'unknownOutcome', reference: '—' } });
  expect(writer.unlocked).toBe(true);
});

test('concurrent submits share one request; reset drops token and key; dispose closes', async () => {
  let release: () => void = () => undefined;
  const send = vi.fn(async (): Promise<Res> => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { bookingId: 'b1', ok: true };
  });
  const { writer } = setup({ send });
  await writer.unlock('123456', 'b1');
  const a = writer.submit(body);
  const b = writer.submit(body);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  release();
  expect(await a).toEqual(await b);
  await writer.unlock('123456', 'b1');
  writer.reset();
  expect(writer.unlocked).toBe(false);
  writer.dispose();
  expect(await writer.submit(body)).toEqual({ kind: 'closed' });
  expect(await writer.unlock('123456', 'b1')).toEqual({ kind: 'closed' });
});
