import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadWorkerConfig } from '../src/config/env.js';
import type { WorkerConfig } from '../src/config/env.js';
import { QUEUE_NAMES } from '../src/queues.js';
import { createWorkerApp, installSignalHandlers } from '../src/worker-app.js';
import type { JobLike, QueueLike, WorkerLike } from '../src/worker-app.js';
import { run } from '../src/main.js';
import {
  bullmqConstructors,
  createBullmqDeps,
  jobAttempt,
  redisOptions,
  type BullmqConstructors,
} from '../src/bullmq.factory.js';
import { createJobRuntime } from '../src/jobs/context.js';
import type { JobAttempt } from '../src/jobs/types.js';

const env = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

const config = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({
  ...loadWorkerConfig(env),
  LOG_LEVEL: 'silent',
  WORKER_CONCURRENCY: 1,
  SHUTDOWN_TIMEOUT_SECONDS: 1,
  ...over,
});

const silentLogger = { info: () => undefined, error: () => undefined };

function harness(close: () => Promise<void> = () => Promise.resolve()) {
  const schedulers: string[] = [];
  const closed: string[] = [];
  const logs: string[] = [];
  const handlers = new Map<string, (job: JobLike) => Promise<void>>();
  const deps = {
    createQueue: (name: string): QueueLike => ({
      add: () => Promise.resolve({}),
      upsertJobScheduler: (
        id: string,
        repeat: { every: number },
        template?: { name: string; data: unknown },
      ) => {
        schedulers.push(`${name}:${id}:${repeat.every}:${JSON.stringify(template)}`);
        return Promise.resolve({});
      },
      close: () => {
        closed.push(name);
        return Promise.resolve();
      },
    }),
    createWorker: (name: string, handler: (job: JobLike) => Promise<void>): WorkerLike => {
      handlers.set(name, handler);
      return {
        close: () => {
          closed.push(name);
          return close();
        },
      };
    },
    log: ({ queue, msg }: { queue: string; msg: string }) => logs.push(`${queue}:${msg}`),
  };
  return { deps, schedulers, closed, logs, handlers };
}

describe('loadWorkerConfig', () => {
  it('áp mặc định, đọc cờ scheduler, từ chối biến sai', () => {
    const cfg = loadWorkerConfig(env);
    expect([
      cfg.WORKER_CONCURRENCY,
      cfg.SHUTDOWN_TIMEOUT_SECONDS,
      cfg.ENABLE_REPEATABLE_SCHEDULERS,
    ]).toEqual([5, 15, false]);
    expect(
      loadWorkerConfig({ ...env, ENABLE_REPEATABLE_SCHEDULERS: 'true' })
        .ENABLE_REPEATABLE_SCHEDULERS,
    ).toBe(true);
    expect(() => loadWorkerConfig({ REDIS_URL: env.REDIS_URL })).toThrow(/DATABASE_URL/);
    expect(() => loadWorkerConfig({ ...env, REDIS_URL: 'http://127.0.0.1:6379' })).toThrow(
      ConfigError,
    );
  });
});

describe('redisOptions', () => {
  it('tách host/port/db, bỏ khoá rỗng', () => {
    expect(redisOptions('redis://127.0.0.1:6380/3')).toEqual({
      host: '127.0.0.1',
      port: 6380,
      db: 3,
    });
    expect(redisOptions('redis://user:pass@redis.local')).toEqual({
      host: 'redis.local',
      port: 6379,
      db: 0,
      username: 'user',
      password: 'pass',
    });
  });
});

describe('createWorkerApp', () => {
  it('đăng ký đủ mọi hàng đợi trong QUEUE_NAMES, scheduler tắt theo mặc định', async () => {
    const h = harness();
    await createWorkerApp(config(), h.deps).start();
    expect([...h.handlers.keys()]).toEqual([...QUEUE_NAMES]);
    expect(h.schedulers).toEqual([]);
  });
  it('bật scheduler cho đúng nhịp: hold-expiry 30 giây + đối chiếu 900 giây, no-show 60 giây, outbox 5 giây, dọn tệp và chi hoàn 30 giây', async () => {
    const h = harness();
    await createWorkerApp(config({ ENABLE_REPEATABLE_SCHEDULERS: true }), h.deps).start();
    expect(h.schedulers).toEqual([
      'q.hold-expiry:q.hold-expiry-scheduler:30000:{"name":"hold-expiry","data":{"mode":"SWEEP"}}',
      'q.hold-expiry:q.hold-expiry-reconcile-scheduler:900000:{"name":"hold-reconcile","data":{"mode":"RECONCILE"}}',
      'q.no-show-mark:q.no-show-mark-scheduler:60000:{"name":"no-show-mark","data":{}}',
      'q.outbox-relay:q.outbox-relay-scheduler:5000:{"name":"outbox-relay","data":{}}',
      'q.export-cleanup:q.export-cleanup-scheduler:900000:{"name":"export-cleanup","data":{}}',
      'q.refund-payout:q.refund-payout-scheduler:30000:{"name":"refund-payout","data":{}}',
    ]);
  });
  it('nhịp lặp lấy từ cấu hình (không hằng số hoá 30/900 giây)', async () => {
    const h = harness();
    await createWorkerApp(
      config({
        ENABLE_REPEATABLE_SCHEDULERS: true,
        HOLD_EXPIRY_INTERVAL_SECONDS: 12,
        HOLD_RECONCILE_INTERVAL_SECONDS: 7,
      }),
      h.deps,
    ).start();
    expect(h.schedulers.slice(0, 2)).toEqual([
      'q.hold-expiry:q.hold-expiry-scheduler:12000:{"name":"hold-expiry","data":{"mode":"SWEEP"}}',
      'q.hold-expiry:q.hold-expiry-reconcile-scheduler:7000:{"name":"hold-reconcile","data":{"mode":"RECONCILE"}}',
    ]);
  });
  it('handler chỉ log rồi trả về', async () => {
    const h = harness();
    await createWorkerApp(config(), h.deps).start();
    await h.handlers.get('q.outbox-relay')?.({ id: '1', name: 'relay', data: {} });
    expect(h.logs).toEqual(['q.outbox-relay:nhận job']);
  });
  it('stop() đóng hết, gọi lại an toàn, không chờ job treo', async () => {
    const h = harness(() => Promise.withResolvers<void>().promise);
    const app = createWorkerApp(config({ SHUTDOWN_TIMEOUT_SECONDS: 0.05 }), h.deps);
    await app.start();
    const started = Date.now();
    await app.stop();
    await app.stop();
    expect(h.closed).toHaveLength(QUEUE_NAMES.length * 2);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('installSignalHandlers', () => {
  it('SIGTERM dừng app rồi thoát 0; tín hiệu sau bị bỏ qua', async () => {
    const h = harness();
    const app = createWorkerApp(config(), h.deps);
    await app.start();
    const exit = vi.fn();
    installSignalHandlers(app, exit, silentLogger);
    process.emit('SIGTERM', 'SIGTERM');
    process.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(exit).toHaveBeenCalledTimes(1);
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });
});

describe('createBullmqDeps', () => {
  it('truyền cấu hình xuống BullMQ và log qua logger', () => {
    const calls: string[] = [];
    const logged: string[] = [];
    const ctors = {
      createQueue: (name: string, connection: unknown) => {
        calls.push(`queue:${name}`);
        expect(connection).toEqual({ host: '127.0.0.1', port: 6379, db: 0 });
        return {
          add: () => Promise.resolve({}),
          upsertJobScheduler: () => Promise.resolve({}),
          close: () => Promise.resolve(),
        };
      },
      createWorker: (
        name: string,
        _connection: unknown,
        concurrency: number,
        _handler: (job: JobLike) => Promise<void>,
      ) => {
        calls.push(`worker:${name}:${concurrency}`);
        return { close: () => Promise.resolve() };
      },
    };
    const deps = createBullmqDeps(
      config({ WORKER_CONCURRENCY: 3 }),
      {
        info: ({ queue }, msg) => logged.push(`${queue}:${msg}`),
        error: () => undefined,
      },
      ctors,
    );
    deps.createWorker('q.channel-sync', () => Promise.resolve());
    deps.createQueue('q.channel-sync');
    deps.log({ queue: 'q.channel-sync', msg: 'ok' });
    expect([calls, logged]).toEqual([
      ['worker:q.channel-sync:3', 'queue:q.channel-sync'],
      ['q.channel-sync:ok'],
    ]);
    expect(typeof bullmqConstructors().createQueue).toBe('function');
  });

  it('bơm lượt chạy của job vào handler thật (attempt 1-based theo opts.attempts)', async () => {
    const processors: ((job: JobLike) => Promise<void>)[] = [];
    const received: JobAttempt[] = [];
    const ctors: BullmqConstructors = {
      createQueue: () => ({
        add: () => Promise.resolve({}),
        upsertJobScheduler: () => Promise.resolve({}),
        close: () => Promise.resolve(),
      }),
      createWorker: (_name, _connection, _concurrency, handler) => {
        processors.push(handler);
        return { close: () => Promise.resolve() };
      },
    };
    const runtime = createJobRuntime(config(), silentLogger);
    try {
      const deps = createBullmqDeps(config(), silentLogger, ctors, {
        handlers: {
          'q.report-export': (_data, _context, attempt) => {
            if (attempt !== undefined) received.push(attempt);
            return Promise.resolve();
          },
        },
        context: runtime.context,
      });
      deps.createWorker('q.report-export', () => Promise.resolve());
      await processors[0]!({ name: 'report-export', data: {}, attemptsMade: 0, maxAttempts: 3 });
      await processors[0]!({ name: 'report-export', data: {}, attemptsMade: 2, maxAttempts: 3 });
    } finally {
      await runtime.close();
    }
    expect(received).toEqual([
      { attempt: 1, attempts: 3 },
      { attempt: 3, attempts: 3 },
    ]);
  });
});

describe('jobAttempt', () => {
  it('đổi attemptsMade của BullMQ thành lượt bắt đầu từ 1 và kẹp trần', () => {
    expect(jobAttempt({ name: 'j', data: {}, attemptsMade: 0, maxAttempts: 3 })).toEqual({
      attempt: 1,
      attempts: 3,
    });
    expect(jobAttempt({ name: 'j', data: {}, attemptsMade: 2, maxAttempts: 3 })).toEqual({
      attempt: 3,
      attempts: 3,
    });
    // Job bị đẩy lại thủ công (attemptsMade ≥ attempts) vẫn được coi là lượt cuối.
    expect(jobAttempt({ name: 'j', data: {}, attemptsMade: 4, maxAttempts: 3 })).toEqual({
      attempt: 3,
      attempts: 3,
    });
    // Thiếu `opts.attempts` (BullMQ mặc định 0) nghĩa là chạy đúng một lượt.
    expect(jobAttempt({ name: 'j', data: {} })).toEqual({ attempt: 1, attempts: 1 });
  });
});

describe('run', () => {
  it('trả 1 khi thiếu cấu hình, trả 0 khi app khởi động', async () => {
    const app = { start: () => Promise.resolve(), stop: () => Promise.resolve() };
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await run({}, () => app)).toBe(1);
    expect(await run(env, () => app)).toBe(0);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });
});
