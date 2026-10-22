import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { payment, result, rig, roomType, toReview } from './walk-in-fixtures';

const down = () => new ApiError({ kind: 'network', message: 'down' });

test('init loads room types for the property and starts at step 1', async () => {
  const r = rig();
  await r.flow.init('p1', '2026-10-22');
  expect(r.flow.state.step).toBe('stay');
  expect(r.flow.state.types).toBe('ready');
  expect(r.flow.state.roomTypes).toEqual([roomType]);
  expect(r.flow.state.stay).toMatchObject({
    propertyId: 'p1',
    checkIn: '2026-10-22',
    checkOut: '2026-10-23',
  });
});

test('init offline or failing shows the load problem and never a fake empty list', async () => {
  const offline = rig({
    roomTypes: async () => {
      throw down();
    },
  });
  await offline.flow.init('p1', '2026-10-22');
  expect(offline.flow.state.types).toBe('offline');
  const broken = rig({
    roomTypes: async () => {
      throw new ApiError({ kind: 'http', status: 500, code: 'E_SYS', message: 'x' });
    },
  });
  await broken.flow.init('p1', '2026-10-22');
  expect(broken.flow.state.types).toBe('error');
});

test('steps advance only when the current form is valid; back keeps the input', async () => {
  const r = rig();
  await r.flow.init('p1', '2026-10-22');
  r.flow.next();
  expect(r.flow.state.step).toBe('stay');
  expect(r.flow.state.stayProblem).toBe('ROOM_TYPE');
  r.flow.setStay({ roomTypeId: 'rt1' });
  expect(r.flow.state.stayProblem).toBeNull();
  r.flow.next();
  expect(r.flow.state.step).toBe('guest');
  r.flow.next();
  expect(r.flow.state.guestProblem).toBe('NAME');
  r.flow.setGuest({ fullName: 'A', phone: '0912345678' });
  r.flow.next();
  expect(r.flow.state.step).toBe('review');
  r.flow.back();
  r.flow.back();
  expect(r.flow.state.step).toBe('stay');
  expect(r.flow.state.stay.roomTypeId).toBe('rt1');
  expect(r.flow.state.guest.fullName).toBe('A');
});

test('create → deposit → pay: five steps, server numbers, one-time PIN token in the body', async () => {
  const r = rig();
  await toReview(r);
  await r.flow.create();
  expect(r.create).toHaveBeenCalledTimes(1);
  expect(r.create.mock.calls[0]?.[1]).toBe('key-1');
  expect(r.flow.state.step).toBe('deposit');
  expect(r.flow.state.result?.booking.depositAmount).toBe(907_000);
  await r.flow.verifyPin('123456');
  expect(r.verify).toHaveBeenCalledWith('123456', 'b1');
  expect(r.flow.state.pin).toBe('verified');
  await r.flow.pay('CASH');
  expect(r.pay).toHaveBeenCalledWith(
    {
      bookingId: 'b1',
      type: 'DEPOSIT',
      method: 'CASH',
      amount: 907_000,
      pinToken: 'pin-token-0123456789',
    },
    'key-2',
  );
  expect(r.flow.state.step).toBe('done');
  expect(r.flow.state.payment).toEqual(payment);
  expect(r.flow.state.pin).toBe('idle');
  await r.flow.pay('CASH');
  expect(r.pay).toHaveBeenCalledTimes(1);
});

test('offline create sends nothing and queues nothing', async () => {
  const r = rig();
  await toReview(r);
  r.online.value = false;
  await r.flow.create();
  expect(r.create).not.toHaveBeenCalled();
  expect(r.flow.state.failure).toEqual({ kind: 'offline' });
  expect(r.flow.state.step).toBe('review');
});

test('unknown outcome on create retries with the same key; a changed form gets a new key', async () => {
  const r = rig();
  r.create.mockRejectedValueOnce(down()).mockRejectedValueOnce(down());
  await toReview(r);
  await r.flow.create();
  expect(r.flow.state.failure).toMatchObject({ kind: 'unknownOutcome' });
  await r.flow.create();
  r.flow.back();
  r.flow.back();
  r.flow.setStay({ roomCount: '2' });
  r.flow.next();
  r.flow.next();
  await r.flow.create();
  expect(r.create.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1', 'key-2']);
  expect(r.flow.state.step).toBe('deposit');
});

test('a certain rejection clears the key and shows code + reason', async () => {
  const r = rig();
  r.create.mockRejectedValueOnce(
    new ApiError({
      kind: 'http',
      status: 409,
      code: 'E_INV_NO_AVAILABILITY',
      message: 'Hết phòng',
    }),
  );
  await toReview(r);
  await r.flow.create();
  expect(r.flow.state.failure).toEqual({
    kind: 'rejected',
    code: 'E_INV_NO_AVAILABILITY',
    status: 409,
    reason: 'Hết phòng',
  });
  await r.flow.create();
  expect(r.create.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-2']);
});

test('concurrent create calls share one request', async () => {
  let release: () => void = () => undefined;
  const r = rig({
    createBooking: vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return result();
    }),
  });
  await toReview(r);
  const first = r.flow.create();
  const second = r.flow.create();
  await vi.waitFor(() => expect(r.flow.state.busy).toBe('creating'));
  release();
  await Promise.all([first, second]);
  expect(r.flow.state.step).toBe('deposit');
});

test('PIN: wrong, locked and expired grants never reach the payment', async () => {
  const r = rig();
  await toReview(r);
  await r.flow.create();
  r.verify.mockRejectedValueOnce(
    new ApiError({ kind: 'http', status: 401, code: 'E_AUTH_INVALID_CREDENTIALS', message: 'x' }),
  );
  await r.flow.verifyPin('000000');
  expect(r.flow.state.pin).toBe('wrong');
  await r.flow.verifyPin('12');
  expect(r.verify).toHaveBeenCalledTimes(1);
  r.verify.mockResolvedValueOnce({
    pinToken: 'pin-token-0123456789',
    expiresAt: new Date(r.clock.value - 1).toISOString(),
  });
  await r.flow.verifyPin('123456');
  expect(r.flow.state.pin).toBe('idle');
  r.verify.mockRejectedValueOnce(
    new ApiError({
      kind: 'http',
      status: 423,
      code: 'E_AUTH_PIN_LOCKED',
      message: 'x',
      retryAfterSeconds: 900,
    }),
  );
  await r.flow.verifyPin('123456');
  expect(r.flow.state).toMatchObject({ pin: 'locked', lockedMinutes: 15 });
  await r.flow.pay('CASH');
  expect(r.pay).not.toHaveBeenCalled();
});

test('unknown outcome on pay retries with the same key and the same token; a definite rejection drops both', async () => {
  const r = rig();
  r.pay.mockRejectedValueOnce(down());
  await toReview(r);
  await r.flow.create();
  await r.flow.verifyPin('123456');
  await r.flow.pay('CASH');
  expect(r.flow.state.failure).toMatchObject({ kind: 'unknownOutcome' });
  expect(r.flow.state.pin).toBe('verified');
  await r.flow.pay('CASH');
  expect(r.pay.mock.calls.map((c) => [c[1], c[0].pinToken])).toEqual([
    ['key-2', 'pin-token-0123456789'],
    ['key-2', 'pin-token-0123456789'],
  ]);

  const q = rig();
  q.pay.mockRejectedValueOnce(
    new ApiError({ kind: 'http', status: 401, code: 'E_AUTH_PIN_REQUIRED', message: 'x' }),
  );
  await toReview(q);
  await q.flow.create();
  await q.flow.verifyPin('123456');
  await q.flow.pay('CASH');
  expect(q.flow.state.pin).toBe('idle');
  await q.flow.pay('CASH');
  expect(q.pay).toHaveBeenCalledTimes(1);
});

test('offline verify/pay send nothing', async () => {
  const r = rig();
  await toReview(r);
  await r.flow.create();
  r.online.value = false;
  await r.flow.verifyPin('123456');
  expect(r.verify).not.toHaveBeenCalled();
  expect(r.flow.state.failure).toEqual({ kind: 'offline' });
});

test('a booking without deposit can be finished without paying; skip also drops the PIN token', async () => {
  const r = rig({ createBooking: async () => result({ depositAmount: 0 }) });
  await toReview(r);
  await r.flow.create();
  await r.flow.pay('CASH');
  expect(r.pay).not.toHaveBeenCalled();
  r.flow.skipDeposit();
  expect(r.flow.state.step).toBe('done');
  expect(r.flow.state.payment).toBeNull();
});

test('dispose stops notifying', async () => {
  const r = rig();
  const listener = vi.fn();
  r.flow.subscribe(listener);
  r.flow.dispose();
  await r.flow.init('p1', '2026-10-22');
  expect(listener).not.toHaveBeenCalled();
});
