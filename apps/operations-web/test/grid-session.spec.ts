import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { GridController, type GridData } from '../src/app/(ops)/inventory-grid/controller';
const range = { from: '2026-11-01', to: '2026-11-03' };
const data: GridData = {
  propertyId: 'p1',
  range,
  properties: [{ id: 'p1', name: 'Synthetic' }],
  rows: [],
  capturedAt: '2026-10-13T00:00:00Z',
};
function deferred<T>() {
  let resolve: (v: T) => void = () => {},
    reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
test('invalid calendar/reversed/huge ranges never call port or allocate date arrays', async () => {
  let calls = 0;
  const c = new GridController(async () => {
    calls++;
    return data;
  }, range);
  for (const r of [
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-11-03', to: '2026-11-01' },
    { from: '0001-01-01', to: '9999-12-31' },
  ]) {
    await c.load('p1', r);
    expect(c.state.phase).toBe('validation');
  }
  expect(calls).toBe(0);
});
test('stale success after range changes cannot overwrite fresh selected dates', async () => {
  const old = deferred<GridData>();
  let calls = 0;
  const c = new GridController(
    async () =>
      ++calls === 1 ? old.promise : { ...data, range: { from: '2026-12-01', to: '2026-12-03' } },
    range,
  );
  const pending = c.load('p1', range);
  await c.load('p1', { from: '2026-12-01', to: '2026-12-03' });
  old.resolve(data);
  await pending;
  expect(c.state.data?.range.from).toBe('2026-12-01');
});
test('same query read failure retains honest stale cache, changed property/range clears cache', async () => {
  let fail = false;
  const c = new GridController(async () => {
    if (fail) throw Error('network');
    return data;
  }, range);
  await c.load('p1', range);
  fail = true;
  await c.load('p1', range);
  expect(c.state.phase).toBe('error');
  expect(c.state.data).toEqual(data);
  await c.load('p2', range);
  expect(c.state.data).toBeNull();
  expect(c.state.properties).toEqual(data.properties);
});
test('denied refresh clears grid and catalogues; late success cannot restore them', async () => {
  const late = deferred<GridData>();
  let calls = 0;
  const c = new GridController(async () => (++calls === 1 ? data : late.promise), range);
  await c.load('p1', range);
  const pending = c.load('p1', range);
  c.deny('expired');
  late.resolve(data);
  await pending;
  expect(c.state.phase).toBe('expired');
  expect(c.state.data).toBeNull();
  expect(c.state.properties).toEqual([]);
});
test('403 from read removes cached values and no empty-success claim', async () => {
  let fail = false;
  const c = new GridController(async () => {
    if (fail) throw new ApiError({ kind: 'http', status: 403, message: 'denied' });
    return data;
  }, range);
  await c.load('p1', range);
  fail = true;
  await c.load('p1', range);
  expect(c.state.phase).toBe('forbidden');
  expect(c.state.data).toBeNull();
  expect(c.state.properties).toHaveLength(0);
});
test('unmount aborts active read and suppresses later listener/state updates', async () => {
  const late = deferred<GridData>();
  let signal: AbortSignal | undefined,
    calls = 0;
  const c = new GridController(async (_p, _r, s) => {
    signal = s;
    return late.promise;
  }, range);
  c.subscribe(() => calls++);
  const pending = c.load('p1', range);
  c.dispose();
  const count = calls;
  late.resolve(data);
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(calls).toBe(count);
  expect(c.state.data).toBeNull();
});
