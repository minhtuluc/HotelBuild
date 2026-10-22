import { expect, test } from 'vitest';
import { formatVnDateTime } from '../src/arrivals/format';
import { resolveScan, unavailableScanner, type QrScanner } from '../src/arrivals/scan';

const row = (code: string) => ({ id: code, code });
const rows = [row('PH-261022-A7K2M'), row('PH-261022-C4D8')];
const scanner = (payload: string): QrScanner => ({
  scan: async () => ({ kind: 'scanned', payload }),
});

test('a scanned booking code opens the matching arrival', async () => {
  const outcome = await resolveScan(scanner('https://x.example/b/ph-261022-c4d8'), rows);
  expect(outcome).toEqual({ kind: 'match', booking: rows[1] });
});

test("a code that is not in today's arrivals is reported, not guessed", async () => {
  expect(await resolveScan(scanner('PH-261022-ZZZZZ'), rows)).toEqual({
    kind: 'noMatch',
    code: 'PH-261022-ZZZZZ',
  });
});

test('garbage payloads are invalid', async () => {
  expect(await resolveScan(scanner('not a booking'), rows)).toEqual({ kind: 'invalid' });
});

test.each(['denied', 'cancelled', 'unavailable'] as const)(
  'scanner outcome %s never blocks the flow',
  async (kind) => {
    expect(await resolveScan({ scan: async () => ({ kind }) }, rows)).toEqual({ kind });
  },
);

test('a scanner that throws is treated as unavailable', async () => {
  const broken: QrScanner = {
    scan: async () => {
      throw new Error('camera');
    },
  };
  expect(await resolveScan(broken, rows)).toEqual({ kind: 'unavailable' });
  expect(await resolveScan(unavailableScanner, rows)).toEqual({ kind: 'unavailable' });
});

test('formatVnDateTime renders Vietnam time dd/MM/yyyy and survives bad input', () => {
  expect(formatVnDateTime('2026-10-22T02:41:00.000Z')).toBe('09:41 22/10/2026');
  expect(formatVnDateTime('2026-10-22T17:30:00.000Z')).toBe('00:30 23/10/2026');
  expect(formatVnDateTime('nope')).toBe('—');
});
