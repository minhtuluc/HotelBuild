import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { OnlinePaymentCreateRequest } from '@pinehill/contracts';
import { PaymentFlow, type PaymentPorts } from '../src/payment/flow';
import {
  approvedAmount,
  canPoll,
  paymentMessage,
  safePaymentUrl,
  paymentReturnUrl,
  isPaymentReturn,
} from '../src/payment/model';
import { memoryStorage } from '../src/storage';
import { booking, payment, balance, key } from './payment-fixtures';
function setup() {
  const offer = { booking: structuredClone(booking), balance: { ...balance } };
  const storage = memoryStorage();
  const originalSet = storage.set;
  storage.set = async (k, v) => {
    if (!/^[a-zA-Z0-9._-]+$/.test(k)) throw Error('Invalid SecureStore key');
    await originalSet(k, v);
  };
  const writes: { body: OnlinePaymentCreateRequest; k: string; saved: string | null }[] = [];
  const calls: string[] = [];
  let connected = true;
  let failWrite = false;
  const ports: PaymentPorts = {
    read: async () => {
      calls.push('read');
      return structuredClone(offer);
    },
    status: async () => {
      calls.push('status');
      return { ...payment };
    },
    create: async (body, k) => {
      writes.push({ body, k, saved: await storage.get('pinehill.payment.00670031.00620031') });
      if (failWrite) throw Error('lost');
      offer.booking.payments = [{ ...payment }];
      return { ...payment };
    },
  };
  const options = {
    ports,
    storage,
    bookingId: 'b1',
    createId: () => key,
    net: { getConnected: async () => connected },
    now: () => Date.parse('2026-12-01T00:00:00.000Z'),
  };
  return {
    flow: new PaymentFlow(options),
    options,
    offer,
    ports,
    storage,
    writes,
    calls,
    offline: () => {
      connected = false;
    },
    lose: () => {
      failWrite = true;
    },
  };
}
test('server integer projection exclusively decides payable amount, never derive deposit minus paid', () => {
  expect(approvedAmount(booking, balance)).toBe(49501);
  for (const amount of [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(approvedAmount(booking, { ...balance, onlineDepositAmount: amount })).toBeNull();
  expect(approvedAmount(booking, { ...balance, bookingId: 'other' })).toBeNull();
});
test('HTTPS PSP URL without credentials/fragment; never execute arbitrary or insecure links', () => {
  expect(safePaymentUrl(payment)).toBe('https://provider.test/pay');
  for (const u of [
    'http://provider.test/pay',
    'javascript:alert(1)',
    'intent://x',
    'https://u:p@provider.test',
    'https://provider.test/#secret',
  ])
    expect(safePaymentUrl({ ...payment, paymentUrl: u })).toBeNull();
});
test('exact native return only routes current booking; query result success carries no authority', () => {
  expect(paymentReturnUrl('b1')).toBe('pinehill-customer://payment/b1');
  expect(
    isPaymentReturn('pinehill-customer://payment/b1?result=success&paymentId=other', 'b1'),
  ).toBe(true);
  for (const url of [
    'pinehill-customer://payment/b2',
    'https://payment/b1',
    'pinehill-customer://payment/b1/extra',
    'pinehill-customer://payment/b1#x',
    'pinehill-customer://evil/payment/b1',
  ])
    expect(isPaymentReturn(url, 'b1')).toBe(false);
});
test('two steps reread and persist async intent before exactly one POST, using exact 49501', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  expect(s.writes).toHaveLength(0);
  expect(await s.flow.confirm()).toBe('https://provider.test/pay');
  expect(s.writes).toHaveLength(1);
  expect(s.writes[0]).toMatchObject({
    k: key,
    body: {
      bookingId: 'b1',
      amount: 49501,
      type: 'DEPOSIT',
      method: 'MOMO',
      returnUrl: 'pinehill-customer://payment/b1',
    },
  });
  const saved = s.writes[0]?.saved;
  if (!saved) throw Error('Expected saved intent');
  expect(JSON.parse(saved)).toMatchObject({
    key,
    body: { amount: 49501 },
  });
  await s.flow.confirm();
  expect(s.writes).toHaveLength(1);
});
test('storage unavailable prevents creating an untrackable financial intent', async () => {
  const s = setup();
  s.storage.set = async () => {
    throw Error('secure storage');
  };
  await s.flow.load();
  await s.flow.prepare('MOMO');
  expect(await s.flow.confirm()).toBeNull();
  expect(s.writes).toHaveLength(0);
});
test('changed server amount or version requires explicit new confirmation', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  s.offer.balance.onlineDepositAmount = 49000;
  expect(await s.flow.confirm()).toBeNull();
  expect(s.flow.state).toMatchObject({ phase: 'confirm', changed: true });
  expect(s.writes).toHaveLength(0);
  await s.flow.confirm();
  expect(s.writes[0]).toMatchObject({ body: { amount: 49000 } });
});
test('missing complete payments list blocks creation even if amount exists', async () => {
  const s = setup();
  delete s.offer.booking.payments;
  await s.flow.load();
  expect(s.flow.state.phase).toBe('blocked');
  await s.flow.prepare('MOMO');
  await s.flow.confirm();
  expect(s.writes).toHaveLength(0);
});
test('another online transaction after prepare fences final POST while partial CASH does not', async () => {
  const s = setup();
  s.offer.booking.payments = [
    { ...payment, paymentId: 'cash1', method: 'CASH', status: 'SUCCEEDED', amount: 250499 },
  ];
  await s.flow.load();
  await s.flow.prepare('MOMO');
  s.offer.booking.payments.push({ ...payment, paymentId: 'another' });
  expect(await s.flow.confirm()).toBeNull();
  expect(s.writes).toHaveLength(0);
  expect(s.flow.state.phase).toBe('unknown');
});
test('missing payment list at final confirmation blocks POST', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  delete s.offer.booking.payments;
  await s.flow.confirm();
  expect(s.writes).toHaveLength(0);
  expect(s.flow.state.phase).toBe('blocked');
});
test('dropped response persists unknown across reload; no blind new or replayed POST', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  s.lose();
  await s.flow.confirm();
  expect(s.flow.state.phase).toBe('unknown');
  const resumed = new PaymentFlow(s.options);
  await resumed.load();
  expect(resumed.state.phase).toBe('unknown');
  await resumed.prepare('VNPAY');
  await resumed.confirm();
  expect(s.writes).toHaveLength(1);
});
test('return rereads GET status then booking; SUCCEEDED HELD means received only', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  await s.flow.confirm();
  s.calls.length = 0;
  s.ports.status = async () => {
    s.calls.push('status');
    return { ...payment, status: 'SUCCEEDED' };
  };
  await s.flow.load();
  expect(s.calls).toEqual(['read', 'status', 'read']);
  expect(s.flow.state.phase).toBe('received');
  expect(s.offer.booking.status).toBe('HELD');
  s.offer.booking.status = 'CONFIRMED';
  await s.flow.load();
  expect(s.flow.state.phase).toBe('confirmed');
  expect(
    paymentMessage({ ...payment, status: 'SUCCEEDED' }, { ...booking, status: 'EXPIRED' }),
  ).toBe('received');
});
test('offline prevents reads and money POST; never converts cache to paid', async () => {
  const s = setup();
  s.offline();
  await s.flow.load();
  expect(s.flow.state.phase).toBe('offline');
  expect(s.calls).toHaveLength(0);
});
test('foreign booking or balance identity rejects without exposing stale state', async () => {
  const s = setup();
  s.offer.booking.id = 'foreign';
  await s.flow.load();
  expect(s.flow.state.offer).toBeUndefined();
  expect(s.flow.state.phase).toBe('error');
});
test('401 and403 clear money data and stop controller separately', async () => {
  for (const status of [401, 403]) {
    const s = setup();
    await s.flow.load();
    s.ports.read = async () => {
      throw new ApiError({ kind: 'http', status, code: 'E_AUTH_FORBIDDEN', message: 'denied' });
    };
    await s.flow.load();
    expect(s.flow.state.offer).toBeUndefined();
    expect(s.flow.state.phase).toBe(status === 401 ? 'expired' : 'forbidden');
    await s.flow.prepare('MOMO');
    expect(s.writes).toHaveLength(0);
  }
});
test('disposed controller never accepts late reads or sends subsequent writes', async () => {
  const s = setup();
  let release = () => {};
  s.ports.read = () =>
    new Promise((resolve) => {
      release = () => resolve(structuredClone(s.offer));
    });
  const pending = s.flow.load();
  await Promise.resolve();
  s.flow.dispose();
  release();
  await pending;
  expect(s.flow.state.offer).toBeUndefined();
  await s.flow.prepare('MOMO');
  await s.flow.confirm();
  expect(s.writes).toHaveLength(0);
});
test('poll stops in background, at12 reads, final status or expiry boundary', () => {
  const at = Date.parse(payment.expiresAt!);
  expect(canPoll(payment, 0, at - 1, true)).toBe(true);
  expect(canPoll(payment, 12, at - 1, true)).toBe(false);
  expect(canPoll(payment, 0, at, false)).toBe(false);
  expect(canPoll(payment, 0, at, true)).toBe(false);
  expect(canPoll({ ...payment, status: 'SUCCEEDED' }, 0, at - 1, true)).toBe(false);
});
