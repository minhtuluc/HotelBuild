import { Writable } from 'node:stream';
import pino from 'pino';
import { expect } from 'vitest';

export const privateMarkers = [
  'synthetic-guest@example.test',
  '0901234567',
  'SYNTHETIC-IDENTITY-181',
  'worker-private-token-fixture',
];
export const privateText = privateMarkers.join(' ');

/** Genuine Pino serialization, with an in-memory destination instead of stdout. */
export function jsonLogSink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: unknown, _encoding, done) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      done();
    },
  });
  const logger = pino({ level: 'info', base: { service: 'worker' } }, stream);
  const text = () => chunks.join('');
  const records = (): unknown[] =>
    text()
      .split('\n')
      .filter(Boolean)
      .map((line): unknown => JSON.parse(line));
  const assertSafe = () => {
    for (const marker of privateMarkers) {
      // Boolean assertions keep synthetic private payload out of failure diffs.
      expect(text().includes(marker)).toBe(false);
      expect(text().includes(encodeURIComponent(marker))).toBe(false);
    }
  };
  return { logger, text, records, assertSafe };
}

/** Preserve runner/other listeners; remove only listeners installed by this test. */
export function signalCleanup(): () => void {
  const before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
  return () => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const)
      for (const listener of process.listeners(signal))
        if (!before[signal].includes(listener)) process.removeListener(signal, listener);
  };
}
