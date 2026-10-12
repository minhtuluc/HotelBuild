import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Payment } from '@pinehill/contracts';
import { expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { paymentPorts } from '../src/payment/api';
import { PaymentFlow } from '../src/payment/flow';
import { memoryStorage } from '../src/storage';
import { booking, balance, payment, key } from './payment-fixtures';
async function fixture(drop = false) {
  let created = 0;
  const calls: {
    method: string;
    path: string;
    auth: string | undefined;
    key: string | undefined;
    body: unknown;
  }[] = [];
  const offer = { ...booking, payments: new Array<Payment>() };
  const respond = async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    calls.push({
      method: req.method ?? '',
      path: req.url ?? '',
      auth: req.headers.authorization,
      key: stringHeader(req.headers['idempotency-key']),
      body,
    });
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer synthetic-access') {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { code: 'E_AUTH_INVALID_CREDENTIALS', message: 'denied' } }));
      return;
    }
    let data: unknown;
    if (req.url === '/api/v1/bookings/b1') data = offer;
    else if (req.url === '/api/v1/bookings/b1/balance') data = balance;
    else if (req.url === '/api/v1/payments/online') {
      created++;
      offer.payments = [payment];
      if (drop) {
        req.socket.destroy();
        return;
      }
      data = payment;
    } else if (req.url === '/api/v1/payments/p1/status') data = payment;
    else {
      res.statusCode = 404;
      data = { error: { code: 'E_GEN_RESOURCE_NOT_FOUND', message: 'not found' } };
    }
    res.end(JSON.stringify(data));
  };
  const server = createServer((req, res) => {
    void respond(req, res).catch((error) =>
      res.destroy(error instanceof Error ? error : Error('HTTP handler failed')),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const client = new ApiClient({
    baseUrl: 'http://127.0.0.1:' + String(port(server.address())) + '/api/v1',
    getAccessToken: () => 'synthetic-access',
    createId: () => key,
    sleep: async () => {},
  });
  const ports = paymentPorts(client, 'b1');
  const storage = memoryStorage();
  const options = {
    ports,
    storage,
    bookingId: 'b1',
    createId: () => key,
    net: { getConnected: async () => true },
    now: () => Date.parse('2026-12-01T00:00:00Z'),
  };
  return {
    flow: new PaymentFlow(options),
    options,
    calls,
    created: () => created,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
test('actual TCP bearer client posts projected amount once and rereads GET status after return', async () => {
  const s = await fixture();
  try {
    await s.flow.load();
    await s.flow.prepare('MOMO');
    expect(await s.flow.confirm()).toBe('https://provider.test/pay');
    await s.flow.load();
    const post = s.calls.filter((c) => c.method === 'POST');
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({
      path: '/api/v1/payments/online',
      auth: 'Bearer synthetic-access',
      key,
      body: { amount: 49501, returnUrl: 'pinehill-customer://payment/b1' },
    });
    const index = s.calls.findIndex((c) => c.path === '/api/v1/payments/p1/status');
    expect(index).toBeGreaterThan(0);
    expect(s.calls.slice(index + 1).some((c) => c.path === '/api/v1/bookings/b1')).toBe(true);
    expect(s.flow.state.phase).toBe('pending');
  } finally {
    await s.close();
  }
});
test('response dropped after server commit: maxAttempts1, restore finds original receipt, no new POST', async () => {
  const s = await fixture(true);
  try {
    await s.flow.load();
    await s.flow.prepare('MOMO');
    await s.flow.confirm();
    expect(s.created()).toBe(1);
    expect(s.flow.state.phase).toBe('unknown');
    const resumed = new PaymentFlow(s.options);
    await resumed.load();
    expect(resumed.state.phase).toBe('pending');
    await resumed.prepare('VNPAY');
    await resumed.confirm();
    expect(s.created()).toBe(1);
  } finally {
    await s.close();
  }
});

function port(address: ReturnType<ReturnType<typeof createServer>['address']>): number {
  if (!address || typeof address === 'string') throw Error('Expected TCP address');
  return address.port;
}
function stringHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  return raw ? JSON.parse(raw) : null;
}
