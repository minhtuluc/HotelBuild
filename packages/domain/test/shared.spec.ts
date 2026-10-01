import { expect, test } from 'vitest';
import { DomainError, err, ok } from '../src/index.js';
import type { Clock, IdGenerator, Result } from '../src/index.js';

test('result discriminants preserve values and domain error identity', () => {
  const failure = new DomainError('E_INVALID', 'Invalid amount');
  const results: Result<number, DomainError>[] = [ok(42), err(failure)];
  expect(results.map((result) => (result.ok ? result.value : result.error.code))).toEqual([
    42,
    'E_INVALID',
  ]);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe('Invalid amount');
  expect(failure.name).toBe('DomainError');
});
test('ports accept injected deterministic time and identifiers', () => {
  const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  const ids: IdGenerator = { generate: () => 'injected-id' };
  expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  expect(ids.generate()).toBe('injected-id');
});

test('port modules expose no runtime implementations', async () => {
  const [clock, ids] = await Promise.all([
    import('../src/shared/clock.js'),
    import('../src/shared/ids.js'),
  ]);
  expect(Object.keys(clock)).toEqual([]);
  expect(Object.keys(ids)).toEqual([]);
});
