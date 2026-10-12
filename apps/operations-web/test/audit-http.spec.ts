import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { ApiClient } from '@pinehill/api-client';
import { auditPort } from '../src/app/(ops)/audit-logs/api';
import { AuditController } from '../src/app/(ops)/audit-logs/controller';
import { EMPTY_AUDIT_FILTERS } from '../src/lib/audit-log';
test('actual TCP authenticated read forwards every declared query field and uses no mutation', async () => {
  const calls: { method: string | undefined; query: URLSearchParams; authenticated: boolean }[] =
    [];
  let denied = false;
  const server = createServer((req, res) => {
    calls.push({
      method: req.method,
      query: new URL(req.url ?? '/', 'http://127.0.0.1').searchParams,
      authenticated: req.headers.authorization === 'Bearer synthetic-access',
    });
    res.setHeader('content-type', 'application/json');
    if (denied) {
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          code: 'E_AUTH_OUT_OF_SCOPE',
          message: 'safe',
          traceId: 'synthetic-trace',
          timestamp: '2026-10-12T00:00:00.000Z',
          path: '/api/v1/audit-logs',
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        data: [
          {
            id: 'a1',
            actorId: 'u1',
            action: 'UPDATE',
            entityType: 'Room',
            entityId: 'r1',
            reason: 'synthetic',
            beforeJson: null,
            afterJson: null,
            createdAt: '2026-10-12T00:00:00.000Z',
          },
        ],
        meta: { limit: 50, total: 1, hasMore: false, nextCursor: null },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('TCP address missing');
  const client = new ApiClient({
    baseUrl: 'http://127.0.0.1:' + address.port + '/api/v1',
    getAccessToken: () => 'synthetic-access',
  });
  const c = new AuditController(auditPort(client));
  try {
    await c.load({
      ...EMPTY_AUDIT_FILTERS,
      actorId: 'u1',
      entityType: 'Room',
      entityId: 'r1',
      action: 'UPDATE',
      from: '2026-11-12T00:00',
      to: '2026-11-13T00:00',
    });
    expect(c.state.rows).toHaveLength(1);
    expect(calls[0]?.authenticated).toBe(true);
    expect(calls[0]?.method).toBe('GET');
    expect(Object.fromEntries(calls[0]?.query ?? [])).toMatchObject({
      actorId: 'u1',
      entityType: 'Room',
      entityId: 'r1',
      action: 'UPDATE',
      from: '2026-11-11T17:00:00.000Z',
      to: '2026-11-12T17:00:00.000Z',
      limit: '50',
    });
    denied = true;
    await c.load(c.state.filters);
    expect(c.state.phase).toBe('forbidden');
    expect(c.state.rows).toHaveLength(0);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
