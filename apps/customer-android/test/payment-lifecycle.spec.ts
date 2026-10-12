import { expect, test } from 'vitest';
import { PaymentLifecycle } from '../src/payment/lifecycle';
import { PaymentFlow } from '../src/payment/flow';
import { memoryStorage } from '../src/storage';
import { booking, balance, payment, key } from './payment-fixtures';
function setup() {
  let now = Date.parse('2026-12-01T00:00:00Z');
  let reads = 0;
  let scheduled: (() => void) | undefined;
  const offer = { booking: { ...booking, payments: [payment] }, balance: { ...balance } };
  const flow = new PaymentFlow({
    bookingId: 'b1',
    storage: memoryStorage(),
    createId: () => key,
    net: { getConnected: async () => true },
    now: () => now,
    ports: {
      read: async () => structuredClone(offer),
      create: async () => payment,
      status: async () => {
        reads++;
        return { ...payment };
      },
    },
  });
  const lifecycle = new PaymentLifecycle({
    flow,
    bookingId: 'b1',
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      expect(ms).toBe(2000);
      scheduled = fn;
      return 1;
    },
    cancel: () => {
      scheduled = undefined;
    },
  });
  return {
    flow,
    lifecycle,
    reads: () => reads,
    queued: () => scheduled !== undefined,
    advance: async () => {
      now += 2000;
      const fn = scheduled;
      scheduled = undefined;
      fn?.();
      await new Promise((r) => setTimeout(r, 0));
    },
    setNow: (value: number) => {
      now = value;
    },
  };
}
test('automatic foreground polling has twelve-read budget and then manual check remains available', async () => {
  const s = setup();
  await s.flow.load();
  s.lifecycle.sync();
  for (let i = 0; i < 15; i++) await s.advance();
  expect(s.reads()).toBe(13);
  expect(s.queued()).toBe(false);
  await s.lifecycle.check();
  expect(s.reads()).toBe(14);
});
test('background stops queued timer; foreground rereads server and restarts within remaining budget', async () => {
  const s = setup();
  await s.flow.load();
  s.lifecycle.sync();
  await s.lifecycle.setActive(false);
  expect(s.queued()).toBe(false);
  await s.advance();
  expect(s.reads()).toBe(1);
  await s.lifecycle.setActive(true);
  expect(s.reads()).toBe(2);
  expect(s.queued()).toBe(true);
  s.lifecycle.dispose();
  expect(s.queued()).toBe(false);
});
test('scheduled callback rechecks expiry, including the last interval before the deadline', async () => {
  const s = setup();
  s.setNow(Date.parse(payment.expiresAt!) - 1000);
  await s.flow.load();
  s.lifecycle.sync();
  await s.advance();
  expect(s.reads()).toBe(1);
  expect(s.queued()).toBe(false);
});
test('forged return on foreign booking does nothing; own success query performs GET only', async () => {
  const s = setup();
  await s.flow.load();
  expect(await s.lifecycle.returnFrom('pinehill-customer://payment/other?result=success')).toBe(
    false,
  );
  expect(s.reads()).toBe(1);
  expect(
    await s.lifecycle.returnFrom('pinehill-customer://payment/b1?result=success&paymentId=foreign'),
  ).toBe(true);
  expect(s.flow.state.phase).toBe('pending');
  expect(s.reads()).toBe(2);
});

test('foreground return still rereads server after scheduled polling budget is exhausted', async () => {
  const s = setup();
  await s.flow.load();
  s.lifecycle.sync();
  for (let i = 0; i < 12; i++) await s.advance();
  expect(s.reads()).toBe(13);
  expect(s.queued()).toBe(false);
  await s.lifecycle.setActive(false);
  await s.lifecycle.setActive(true);
  expect(s.reads()).toBe(14);
  expect(s.queued()).toBe(false);
});
