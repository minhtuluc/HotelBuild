import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { AuditLogEntry, ListPage } from '@pinehill/contracts';
import { AuditController, type AuditPort } from '../src/app/(ops)/audit-logs/controller';
import { EMPTY_AUDIT_FILTERS, toCsv } from '../src/lib/audit-log';
const row: AuditLogEntry = {
  id: 'a1',
  actorId: 'u1',
  action: 'UPDATE',
  entityType: 'SystemSetting',
  entityId: 'pricing.maxDiscountPct',
  reason: 'synthetic reason',
  beforeJson: null,
  afterJson: null,
  createdAt: '2026-10-12T00:00:00Z',
};
const page = (
  rows: AuditLogEntry[] = [row],
  cursor: string | null = null,
): ListPage<AuditLogEntry> => ({
  data: rows,
  meta: { limit: 50, nextCursor: cursor, hasMore: cursor !== null, total: rows.length },
});
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const controller = (port: AuditPort) =>
  new AuditController(port, () => Date.parse('2026-10-12T00:00:00Z'));
test('loads explicit filters; pagination merges IDs while preserving server order', async () => {
  const calls: unknown[] = [];
  const c = controller(async (query) => {
    calls.push(query);
    return query.cursor ? page([row, { ...row, id: 'a2' }]) : page([row], 'next');
  });
  await c.load({ ...EMPTY_AUDIT_FILTERS, action: 'UPDATE' });
  await c.loadMore();
  expect(c.state.rows.map((r) => r.id)).toEqual(['a1', 'a2']);
  expect(calls).toEqual([
    { action: 'UPDATE', limit: 50 },
    { action: 'UPDATE', limit: 50, cursor: 'next' },
  ]);
});
test('new filter clears old rows immediately and ignores old late success', async () => {
  const first = deferred<ListPage<AuditLogEntry>>();
  let calls = 0;
  const c = controller(async () => (++calls === 1 ? first.promise : page([{ ...row, id: 'new' }])));
  const old = c.load(EMPTY_AUDIT_FILTERS);
  await c.load({ ...EMPTY_AUDIT_FILTERS, action: 'LOGIN' });
  first.resolve(page());
  await old;
  expect(c.state.rows.map((r) => r.id)).toEqual(['new']);
  expect(c.state.filters.action).toBe('LOGIN');
});
test('denial clears export rows/cursor and rejects a pagination result already in flight', async () => {
  const more = deferred<ListPage<AuditLogEntry>>();
  const c = controller(async (query) => (query.cursor ? more.promise : page([row], 'next')));
  await c.load(EMPTY_AUDIT_FILTERS);
  const waiting = c.loadMore();
  c.deny('expired');
  more.resolve(page([{ ...row, id: 'a2' }]));
  await waiting;
  expect(c.state).toMatchObject({
    rows: [],
    nextCursor: null,
    phase: 'expired',
    loadingMore: false,
  });
  expect(toCsv(c.state.rows)).not.toContain('synthetic reason');
});
test('403 response from an older request wins over later ready data, clears protected rows', async () => {
  const old = deferred<ListPage<AuditLogEntry>>();
  let calls = 0;
  const c = controller(async () => (++calls === 1 ? old.promise : page()));
  const first = c.load(EMPTY_AUDIT_FILTERS);
  await c.load({ ...EMPTY_AUDIT_FILTERS, action: 'UPDATE' });
  old.reject(new ApiError({ kind: 'http', status: 403, message: 'denied' }));
  await first;
  expect(c.state.phase).toBe('forbidden');
  expect(c.state.rows).toHaveLength(0);
});
test('same-filter refresh read failure preserves rows; first failure is an error, never empty', async () => {
  let fail = false;
  const port: AuditPort = async () => {
    if (fail) throw Error('network');
    return page();
  };
  const c = controller(port);
  await c.load(EMPTY_AUDIT_FILTERS);
  fail = true;
  await c.load(EMPTY_AUDIT_FILTERS);
  expect(c.state.phase).toBe('error');
  expect(c.state.rows).toHaveLength(1);
  const first = controller(port);
  await first.load(EMPTY_AUDIT_FILTERS);
  expect(first.state.phase).toBe('error');
  expect(first.state.rows).toHaveLength(0);
});
test('dispose cancels request and suppresses all late notifications', async () => {
  const read = deferred<ListPage<AuditLogEntry>>();
  let signal: AbortSignal | undefined;
  const c = controller(async (_query, s) => {
    signal = s;
    return read.promise;
  });
  let updates = 0;
  c.subscribe(() => updates++);
  const pending = c.load(EMPTY_AUDIT_FILTERS);
  c.dispose();
  const before = updates;
  read.resolve(page());
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(updates).toBe(before);
  expect(c.state.rows).toHaveLength(0);
});

test('loadMore cannot reuse an old cursor while same-filter refresh is in flight', async () => {
  const refresh = deferred<ListPage<AuditLogEntry>>();
  let calls = 0;
  let cursorReads = 0;
  const c = controller(async (query) => {
    calls++;
    if (query.cursor) {
      cursorReads++;
      return page([{ ...row, id: 'appended' }], 'newcursor');
    }
    return calls === 1 ? page([row], 'oldcursor') : refresh.promise;
  });
  await c.load(EMPTY_AUDIT_FILTERS);
  const waiting = c.load(EMPTY_AUDIT_FILTERS);
  expect(c.state.phase).toBe('refreshing');
  await c.loadMore();
  expect(cursorReads).toBe(0);
  refresh.resolve(page([{ ...row, id: 'fresh' }], 'freshcursor'));
  await waiting;
  expect(c.state.rows.map((r) => r.id)).toEqual(['fresh']);
  expect(c.state.nextCursor).toBe('freshcursor');
});
