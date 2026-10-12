import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { bookingSummarySchema, paymentSchema } from '@pinehill/contracts';
import { booking } from '../../../../packages/web-session/test/journey-fixtures.js';
import {
  PaymentFlow,
  type PaymentPorts,
} from '../../src/app/(guest)/booking/[bookingId]/pay/payment-flow';
const p = paymentSchema.parse({
  paymentId: 'p1',
  bookingId: booking.id,
  type: 'DEPOSIT',
  method: 'MOMO',
  amount: 49501,
  status: 'PENDING',
  providerTxnId: null,
  paymentUrl: 'https://provider.test/pay',
  expiresAt: null,
  paidAt: null,
  createdAt: new Date().toISOString(),
});
function setup() {
  let offer = {
    booking: bookingSummarySchema.parse({ ...booking, payments: [] }),
    balance: {
      bookingId: booking.id,
      currency: 'VND' as const,
      totalAmount: 1000000,
      paidAmount: 250499,
      refundedAmount: 0,
      reservedRefundAmount: 0,
      balanceDue: 749501,
      onlineDepositAmount: 49501,
    },
  };
  const saved = new Map<string, string>();
  let creates = 0;
  let fail: Error | undefined;
  const ports: PaymentPorts = {
    read: async () => {
      if (fail) throw fail;
      return structuredClone(offer);
    },
    status: async () => structuredClone(p),
    create: async () => {
      creates++;
      offer.booking.payments = [p];
      return structuredClone(p);
    },
  };
  const storage = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => {
      saved.set(k, v);
    },
  };
  const flow = new PaymentFlow({
    ports,
    storage,
    bookingId: booking.id,
    origin: 'https://guest.test',
    key: () => '7ed2bdb1-c3e0-467f-89e0-058f08173141',
  });
  return {
    flow,
    ports,
    storage,
    saved,
    offer,
    creates: () => creates,
    setFail: (e: Error) => {
      fail = e;
    },
  };
}
test('two steps with fresh reread; exact projected amount posted once and persisted before request', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  expect(s.creates()).toBe(0);
  expect(await s.flow.confirm()).toBe('https://provider.test/pay');
  expect(s.creates()).toBe(1);
  expect([...s.saved.values()].map((v): unknown => JSON.parse(v))[0]).toMatchObject({
    body: { amount: 49501, method: 'MOMO', type: 'DEPOSIT' },
    paymentId: 'p1',
  });
  await s.flow.confirm();
  expect(s.creates()).toBe(1);
});
test('changed amount requires confirming the new server offer again', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  s.offer.balance.onlineDepositAmount = 49000;
  expect(await s.flow.confirm()).toBeNull();
  expect(s.creates()).toBe(0);
  expect(s.flow.state.phase).toBe('confirm');
});
test('storage failure cannot send an untrackable payment request', async () => {
  const s = setup();
  s.storage.setItem = () => {
    throw Error('quota');
  };
  await s.flow.load();
  await s.flow.prepare('MOMO');
  expect(await s.flow.confirm()).toBeNull();
  expect(s.creates()).toBe(0);
  expect(s.flow.state.phase).toBe('error');
});
test('lost response stays unknown across reload; read server payment instead of a second POST', async () => {
  const s = setup();
  s.ports.create = async () => {
    s.offer.booking.payments = [p];
    throw new ApiError({ kind: 'network', message: 'lost' });
  };
  await s.flow.load();
  await s.flow.prepare('MOMO');
  expect(await s.flow.confirm()).toBeNull();
  expect(s.flow.state.phase).toBe('unknown');
  const restored = new PaymentFlow({
    ports: s.ports,
    storage: s.storage,
    bookingId: booking.id,
    origin: 'https://guest.test',
  });
  await restored.load();
  expect(restored.state.phase).toBe('pending');
  await restored.prepare('VNPAY');
  expect(restored.state.phase).toBe('pending');
});
test('unknown with no server payment cannot create again or forget intent', async () => {
  const s = setup();
  s.ports.create = async () => {
    throw new ApiError({ kind: 'http', status: 504, message: 'timeout' });
  };
  await s.flow.load();
  await s.flow.prepare('MOMO');
  await s.flow.confirm();
  await s.flow.load();
  expect(s.flow.state.phase).toBe('unknown');
  await s.flow.prepare('VNPAY');
  expect(s.flow.state.phase).toBe('unknown');
  expect(s.saved.size).toBe(1);
});
test('foreign payment identity cannot be displayed or redirected', async () => {
  const s = setup();
  s.offer.booking.payments = [p];
  s.ports.status = async () => ({ ...p, bookingId: 'foreign' });
  await s.flow.load('p1');
  expect(s.flow.state.phase).toBe('error');
  expect(s.flow.state.payment).toBeUndefined();
});
test('late success reads the server booking, never mutates EXPIRED to CONFIRMED', async () => {
  const s = setup();
  s.offer.booking.payments = [p];
  s.offer.booking.status = 'EXPIRED';
  s.ports.status = async () => ({ ...p, status: 'SUCCEEDED' });
  await s.flow.load('p1');
  expect(s.flow.state.phase).toBe('received');
  expect(s.flow.state.offer?.booking.status).toBe('EXPIRED');
});
test('expired auth removes previously displayed amounts', async () => {
  const s = setup();
  await s.flow.load();
  s.setFail(new ApiError({ kind: 'http', status: 403, message: 'denied' }));
  await s.flow.load();
  expect(s.flow.state.phase).toBe('forbidden');
  expect(s.flow.state.offer).toBeUndefined();
});
test('dispose suppresses an in flight late result', async () => {
  const s = setup();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  s.ports.read = async () => {
    await gate;
    return structuredClone(s.offer);
  };
  const loading = s.flow.load();
  s.flow.dispose();
  release();
  await loading;
  expect(s.flow.state.offer).toBeUndefined();
});
test('a final POST reply must still be checked through GET status and a fresh booking', async () => {
  const s = setup();
  s.ports.create = async () => ({ ...p, status: 'SUCCEEDED' });
  s.ports.status = async () => ({ ...p, status: 'SUCCEEDED' });
  await s.flow.load();
  await s.flow.prepare('MOMO');
  expect(await s.flow.confirm()).toBeNull();
  expect(s.flow.state.phase).toBe('received');
});

test('fresh external online payment after prepare fences a second POST even when version and money stay unchanged', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  s.offer.booking.payments = [p];
  expect(await s.flow.confirm()).toBeNull();
  expect(s.creates()).toBe(0);
  expect(s.flow.state.phase).toBe('unknown');
  expect(s.saved.size).toBe(0);
});
test('a refreshed booking without a complete payment list cannot enter confirmation', async () => {
  const s = setup();
  await s.flow.load();
  delete s.offer.booking.payments;
  await s.flow.prepare('MOMO');
  expect(s.flow.state.phase).toBe('blocked');
  expect(s.creates()).toBe(0);
});
test('a payment list lost between two steps cannot reach POST', async () => {
  const s = setup();
  await s.flow.load();
  await s.flow.prepare('MOMO');
  delete s.offer.booking.payments;
  expect(await s.flow.confirm()).toBeNull();
  expect(s.creates()).toBe(0);
  expect(s.flow.state.phase).toBe('blocked');
  expect(s.saved.size).toBe(0);
});
