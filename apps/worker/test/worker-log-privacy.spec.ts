import { expect, test, vi } from 'vitest';
import { createBullmqDeps, type BullmqConstructors } from '../src/bullmq.factory.js';
import { loadWorkerConfig } from '../src/config/env.js';
import { QUEUE_NAMES } from '../src/queues.js';
import { createWorkerApp, installSignalHandlers, type JobLike } from '../src/worker-app.js';
import { jsonLogSink, privateText, signalCleanup } from './log-privacy-fixtures.js';

const config = loadWorkerConfig({
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
});
test.each(QUEUE_NAMES)('%s logs receipt without serializing job name/id/payload', async (queue) => {
  const sink = jsonLogSink();
  const handlers = new Map<string, (job: JobLike) => Promise<void>>();
  const ctors: BullmqConstructors = {
    createQueue: () => ({
      add: async () => undefined,
      upsertJobScheduler: async () => undefined,
      close: async () => undefined,
    }),
    createWorker: (name, _connection, _concurrency, handler) => {
      handlers.set(name, handler);
      return { close: async () => undefined };
    },
  };
  const app = createWorkerApp(config, createBullmqDeps(config, sink.logger, ctors));
  const job = Object.freeze({
    id: privateText,
    name: privateText,
    data: Object.freeze({ nested: { privateText } }),
  });
  try {
    await app.start();
    const handler = handlers.get(queue);
    if (!handler) throw Error('Processor was not registered');
    await handler(job);
    sink.assertSafe();
    expect(sink.records()).toEqual([
      expect.objectContaining({ level: 30, service: 'worker', queue, msg: 'nhận job' }),
    ]);
    expect(job).toEqual({ id: privateText, name: privateText, data: { nested: { privateText } } });
  } finally {
    await app.stop();
  }
});

const rejected: { label: string; value: unknown }[] = [
  {
    label: 'Error with message/stack/cause/extra fields',
    value: Object.assign(new Error(privateText, { cause: new Error(privateText) }), {
      token: privateText,
    }),
  },
  { label: 'nested record', value: { message: privateText, nested: { token: privateText } } },
  { label: 'string', value: privateText },
  { label: 'null', value: null },
];
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test.each(rejected)(
    `${signal} failed shutdown records a safe error and exits once: $label`,
    async ({ value }) => {
      const sink = jsonLogSink();
      const cleanup = signalCleanup();
      const exits: number[] = [];
      let stops = 0;
      const app = {
        start: async () => undefined,
        stop: async () => {
          stops++;
          throw value;
        },
      };
      try {
        installSignalHandlers(app, (code) => exits.push(code), sink.logger);
        process.emit(signal, signal);
        process.emit('SIGTERM', 'SIGTERM');
        process.emit('SIGINT', 'SIGINT');
        await vi.waitFor(() => expect(exits).toEqual([1]));
        expect(stops).toBe(1);
        sink.assertSafe();
        expect(sink.records()).toEqual([
          expect.objectContaining({
            level: 50,
            service: 'worker',
            queue: 'all',
            component: 'shutdown',
            errorCode: 'UNKNOWN',
            msg: `nhận ${signal}: dừng worker thất bại`,
          }),
        ]);
        expect(sink.records()[0]).not.toHaveProperty('err');
        expect(sink.records()[0]).not.toHaveProperty('cause');
        expect(sink.records()[0]).not.toHaveProperty('stack');
      } finally {
        cleanup();
      }
    },
  );
  test(`${signal} successful shutdown retains one info record and exit zero`, async () => {
    const sink = jsonLogSink();
    const cleanup = signalCleanup();
    const exits: number[] = [];
    let stops = 0;
    try {
      installSignalHandlers(
        {
          start: async () => undefined,
          stop: async () => {
            stops++;
          },
        },
        (code) => exits.push(code),
        sink.logger,
      );
      process.emit(signal, signal);
      process.emit('SIGTERM', 'SIGTERM');
      process.emit('SIGINT', 'SIGINT');
      await vi.waitFor(() => expect(exits).toEqual([0]));
      expect(stops).toBe(1);
      expect(sink.records()).toEqual([
        expect.objectContaining({ level: 30, queue: 'all', msg: `nhận ${signal}: đã dừng êm` }),
      ]);
    } finally {
      cleanup();
    }
  });
}
