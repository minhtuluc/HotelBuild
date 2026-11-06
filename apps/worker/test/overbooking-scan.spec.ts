/**
 * HB-127 — worker quét quá tải: các ràng buộc không cần CSDL (tên hàng đợi, nhịp từ SystemSetting,
 * đăng ký lịch dưới một identity, nhịp các hàng đợi khác, quan sát được và không tác động tiền).
 * Phần chạy trên PostgreSQL/Redis thật nằm ở `overbooking-scan.integration.spec.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkerConfig } from '../src/config/env.js';
import { createBullmqDeps } from '../src/bullmq.factory.js';
import type { BullmqConstructors } from '../src/bullmq.factory.js';
import { createLogger } from '../src/pino.logger.js';
import type { JobContext, JobHandler } from '../src/jobs/types.js';
import {
  DEFAULT_SCAN_INTERVAL_MINUTES,
  SCAN_INTERVAL_KEY,
  parseScanIntervalMinutes,
  readScanInterval,
  scanIntervalMs,
} from '../src/overbooking/interval.js';
import type { ScanInterval } from '../src/overbooking/interval.js';
import { createScanScheduleSync } from '../src/overbooking/schedule.js';
import type { ScanScheduleSource } from '../src/overbooking/schedule.js';
import { overbookingScanJob } from '../src/overbooking/scan.job.js';
import {
  OVERBOOKING_SCAN_JOB,
  OVERBOOKING_SCAN_QUEUE,
  OVERBOOKING_SCAN_SCHEDULER_ID,
  QUEUE_NAMES,
} from '../src/queues.js';
import type { QueueName } from '../src/queues.js';
import { createWorkerApp } from '../src/worker-app.js';
import type { JobLike, QueueLike, WorkerLike } from '../src/worker-app.js';

const workerSrc = fileURLToPath(new URL('../src/', import.meta.url));
const apiSeedSettings = fileURLToPath(
  new URL('../../api/prisma/seed/settings.ts', import.meta.url),
);

const env = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
};
const config = (over: Partial<ReturnType<typeof loadWorkerConfig>> = {}) => ({
  ...loadWorkerConfig(env),
  LOG_LEVEL: 'silent' as const,
  WORKER_CONCURRENCY: 1,
  SHUTDOWN_TIMEOUT_SECONDS: 1,
  ...over,
});

interface Upsert {
  readonly queue: string;
  readonly id: string;
  readonly every: number;
  readonly template: { name: string; data: unknown } | undefined;
}

function fakeQueue(name: string, upserts: Upsert[], closed: string[] = []): QueueLike {
  return {
    add: () => Promise.resolve({}),
    upsertJobScheduler: (id, repeat, template) => {
      upserts.push({ queue: name, id, every: repeat.every, template });
      return Promise.resolve({});
    },
    close: () => {
      closed.push(name);
      return Promise.resolve();
    },
  };
}

interface Reports {
  readonly entries: { msg: string; errorCode?: string }[];
}

function fakeSource(minutes: () => number | Error, reads: { count: number } = { count: 0 }) {
  const reports: Reports = { entries: [] };
  const source: ScanScheduleSource = {
    read: () => {
      reads.count += 1;
      const value = minutes();
      return value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve<ScanInterval>({ minutes: value, source: 'SETTING' });
    },
    report: ({ msg, errorCode }) => {
      reports.entries.push(errorCode === undefined ? { msg } : { msg, errorCode });
    },
  };
  return { source, reports, reads };
}

/** `PrismaClient` thật nhưng chưa nối: chỉ phương thức được `spyOn` mới chạy, không có kết nối nào mở. */
function unconnectedDb(): PrismaClient {
  return new PrismaClient({ datasourceUrl: 'postgresql://x:y@127.0.0.1:1/none' });
}

function context(
  db: PrismaClient,
  logs: { queue: QueueName; msg: string; errorCode?: string }[],
): JobContext {
  return {
    db,
    config: config(),
    clock: { now: () => new Date('2026-12-03T03:00:00Z') },
    log: (entry) => {
      logs.push(entry);
    },
  };
}

/** Hàng `system_settings` đầy đủ cột để không phải ép kiểu. */
function settingRow(value: string) {
  const at = new Date('2026-12-01T00:00:00Z');
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key: SCAN_INTERVAL_KEY,
    value,
    value_type: 'NUMBER',
    description: null,
    updated_by: null,
    created_at: at,
    updated_at: at,
    version: 1n,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HB-127 nhịp quét 60 phút từ SystemSetting', () => {
  it('HB127_default_sixty_minutes_from_setting', async () => {
    // Tên hàng đợi chỉ được khai báo một lần; mọi chỗ khác dùng hằng.
    expect(OVERBOOKING_SCAN_QUEUE).toBe('q.overbooking-scan');
    expect(QUEUE_NAMES.filter((name) => name === OVERBOOKING_SCAN_QUEUE)).toHaveLength(1);
    const literal = /['"]q\.overbooking-scan['"]/;
    const holders: string[] = [];
    const pending = [workerSrc];
    while (pending.length > 0) {
      const dir = pending.pop();
      if (dir === undefined) break;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) pending.push(full);
        else if (entry.name.endsWith('.ts') && literal.test(readFileSync(full, 'utf8')))
          holders.push(full.slice(workerSrc.length));
      }
    }
    expect(holders).toEqual(['queues.ts']);

    // 60 phút = 3.600.000 ms: không nhầm minutes→seconds (60.000 / 3.600) và không phải 300 giây.
    expect(DEFAULT_SCAN_INTERVAL_MINUTES).toBe(60);
    expect(scanIntervalMs(DEFAULT_SCAN_INTERVAL_MINUTES)).toBe(3_600_000);
    expect(scanIntervalMs(60)).not.toBe(60_000);
    expect(scanIntervalMs(60)).not.toBe(300_000);

    // Mặc định trùng giá trị seed của khoá chính thức (HB-018).
    const seed = readFileSync(apiSeedSettings, 'utf8');
    const seeded = new RegExp(`key: '${SCAN_INTERVAL_KEY}',\\s*value: '(\\d+)'`).exec(seed);
    expect(seeded?.[1]).toBe(String(DEFAULT_SCAN_INTERVAL_MINUTES));

    // Đọc setting '60' → SETTING; không có hàng → FALLBACK 60.
    const db = unconnectedDb();
    const find = vi.spyOn(db.system_settings, 'findUnique');
    find.mockResolvedValueOnce(settingRow('60'));
    expect(await readScanInterval(db)).toEqual({ minutes: 60, source: 'SETTING' });
    find.mockResolvedValueOnce(null);
    expect(await readScanInterval(db)).toEqual({ minutes: 60, source: 'FALLBACK' });
    expect(find).toHaveBeenCalledWith({
      where: { key: SCAN_INTERVAL_KEY },
      select: { value: true },
    });

    // Lịch đăng ký đúng 3.600.000 ms dưới identity ổn định.
    const upserts: Upsert[] = [];
    const { source } = fakeSource(() => 60);
    const sync = createScanScheduleSync(fakeQueue(OVERBOOKING_SCAN_QUEUE, upserts), source, 1000);
    await sync.start();
    sync.stop();
    expect(upserts).toEqual([
      {
        queue: OVERBOOKING_SCAN_QUEUE,
        id: OVERBOOKING_SCAN_SCHEDULER_ID,
        every: 3_600_000,
        template: { name: OVERBOOKING_SCAN_JOB, data: {} },
      },
    ]);
  });

  it('HB127_reload_setting_reschedules_one_identity', async () => {
    vi.useFakeTimers();
    let minutes = 60;
    const upserts: Upsert[] = [];
    const { source, reports } = fakeSource(() => minutes);
    const sync = createScanScheduleSync(fakeQueue(OVERBOOKING_SCAN_QUEUE, upserts), source, 1000);
    await sync.start();
    expect(sync.current()).toBe(60);

    // Không đổi → không upsert thêm.
    await vi.advanceTimersByTimeAsync(3000);
    expect(upserts).toHaveLength(1);

    // Đổi hợp lệ → cập nhật đúng identity cũ, không nhân lịch, không cần khởi động lại.
    minutes = 15;
    await vi.advanceTimersByTimeAsync(1000);
    expect(upserts.map((upsert) => [upsert.id, upsert.every])).toEqual([
      [OVERBOOKING_SCAN_SCHEDULER_ID, 3_600_000],
      [OVERBOOKING_SCAN_SCHEDULER_ID, 900_000],
    ]);
    expect(new Set(upserts.map((upsert) => upsert.id)).size).toBe(1);
    expect(sync.current()).toBe(15);

    // Đọc lỗi → giữ nhịp đang chạy, không về 0, không dừng lịch.
    const failing = fakeSource(() => new Error('db down 0900000000'));
    const keep: Upsert[] = [];
    const held = createScanScheduleSync(
      fakeQueue(OVERBOOKING_SCAN_QUEUE, keep),
      failing.source,
      1000,
    );
    await held.start(); // chưa từng áp được nhịp nào ⇒ lịch mặc định 60 phút
    expect(held.current()).toBe(60);
    expect(keep.map((upsert) => upsert.every)).toEqual([3_600_000]);
    await held.reload();
    expect(keep).toHaveLength(1);
    held.stop();
    sync.stop();

    // Log: không PII/thông điệp thô của lỗi, chỉ nhịp và mã ổn định.
    const text = JSON.stringify([...reports.entries, ...failing.reports.entries]);
    expect(text).not.toContain('0900000000');
    expect(text).not.toContain('db down');
    expect(
      failing.reports.entries.some(
        (entry) => entry.errorCode === 'OVERBOOKING_SCAN_INTERVAL_READ_FAILED',
      ),
    ).toBe(true);
    expect(reports.entries.map((entry) => entry.msg)).toEqual([
      expect.stringContaining('chưa có → 60 phút'),
      expect.stringContaining('60 phút → 15 phút'),
    ]);

    // Giá trị thiếu/sai không bao giờ thành 0: rơi về 60 phút và gắn nhãn FALLBACK.
    for (const raw of [
      null,
      undefined,
      '',
      ' ',
      '0',
      '-5',
      '1e2',
      '0x3c',
      '60.5',
      'abc',
      '1441',
      '99999',
      '6 0',
    ]) {
      expect(parseScanIntervalMinutes(raw), String(raw)).toBeNull();
    }
    expect(parseScanIntervalMinutes(' 30 ')).toBe(30);
    expect(parseScanIntervalMinutes('1440')).toBe(1440);
    const db = unconnectedDb();
    const find = vi.spyOn(db.system_settings, 'findUnique');
    find.mockResolvedValueOnce(settingRow('0'));
    expect(await readScanInterval(db)).toEqual({ minutes: 60, source: 'FALLBACK' });
  });

  it('HB127_shutdown_and_other_queues_unchanged', async () => {
    vi.useFakeTimers();
    const run = async (withScan: boolean, enabled = true) => {
      const upserts: Upsert[] = [];
      const closed: string[] = [];
      const handlers = new Map<string, (job: JobLike) => Promise<void>>();
      const fake = fakeSource(() => 60);
      const app = createWorkerApp(config({ ENABLE_REPEATABLE_SCHEDULERS: enabled }), {
        createQueue: (name) => fakeQueue(name, upserts, closed),
        createWorker: (name, handler): WorkerLike => {
          handlers.set(name, handler);
          return {
            close: () => {
              closed.push(name);
              return Promise.resolve();
            },
          };
        },
        log: () => undefined,
        ...(withScan ? { scanSchedule: fake.source } : {}),
      });
      await app.start();
      return { app, upserts, closed, fake, handlers };
    };
    const describeUpsert = (upsert: Upsert) =>
      `${upsert.queue}:${upsert.id}:${upsert.every}:${JSON.stringify(upsert.template)}`;

    const baseline = await run(false);
    const withScan = await run(true);
    // Thêm scan KHÔNG đổi lịch các hàng đợi khác (hold, OTA, outbox, no-show, dọn tệp, chi hoàn, cảnh báo).
    const others = withScan.upserts.filter((upsert) => upsert.queue !== OVERBOOKING_SCAN_QUEUE);
    expect(others.map(describeUpsert)).toEqual(baseline.upserts.map(describeUpsert));
    expect(baseline.upserts.map((upsert) => upsert.queue)).not.toContain(OVERBOOKING_SCAN_QUEUE);
    expect(
      withScan.upserts
        .filter((upsert) => upsert.queue === OVERBOOKING_SCAN_QUEUE)
        .map(describeUpsert),
    ).toEqual([
      `q.overbooking-scan:${OVERBOOKING_SCAN_SCHEDULER_ID}:3600000:{"name":"overbooking-scan","data":{}}`,
    ]);

    // Cờ scheduler tắt ⇒ không đọc setting, không đăng ký lịch.
    const off = await run(true, false);
    expect(off.upserts).toEqual([]);
    expect(off.fake.reads.count).toBe(0);

    // SIGTERM/stop: ngừng đọc lại nhịp (không nhận lịch quét mới), đóng đủ worker + queue.
    const reads = withScan.fake.reads.count;
    await withScan.app.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(withScan.fake.reads.count).toBe(reads);
    expect(withScan.closed).toHaveLength(QUEUE_NAMES.length * 2);
    expect(withScan.closed).toContain(OVERBOOKING_SCAN_QUEUE);
    await baseline.app.stop();
    await off.app.stop();
  });
});

describe('HB-127 handler quét', () => {
  it('HB127_observable_scan_without_financial_effects', async () => {
    const db = unconnectedDb();
    const find = vi.spyOn(db.properties, 'findMany').mockResolvedValue([]);
    const transaction = vi.spyOn(db, '$transaction');
    const logs: { queue: QueueName; msg: string; errorCode?: string }[] = [];
    await overbookingScanJob(
      {},
      context(db, logs),
      { attempt: 1, attempts: 3 },
      { id: 'job-7', name: OVERBOOKING_SCAN_JOB },
    );
    // Gọi use case đúng một lần, quét mọi cơ sở ACTIVE; scan rỗng không mở transaction nào.
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]?.[0]?.where).toEqual({ status: 'ACTIVE' });
    expect(transaction).not.toHaveBeenCalled();
    expect(logs.map((entry) => entry.queue)).toEqual([
      OVERBOOKING_SCAN_QUEUE,
      OVERBOOKING_SCAN_QUEUE,
    ]);
    expect(logs[0]).toMatchObject({ msg: 'bắt đầu quét quá tải', jobId: 'job-7' });
    expect(logs[1]?.msg).toMatch(
      /^quét quá tải xong: 0 kết cục, 0 ca mới, 0 leo thang, \d+ ms, 0 lỗi$/,
    );
    expect(logs.every((entry) => entry.errorCode === undefined)).toBe(true);

    // Lỗi: log mã ổn định, ném lại đúng mã đó; thông điệp thô (có thể chứa PII) không đi đâu cả.
    find.mockRejectedValueOnce(new Error('connect failed for guest 0900000129 token=abc'));
    const failed: typeof logs = [];
    await expect(overbookingScanJob({}, context(db, failed))).rejects.toThrow(
      new Error('OVERBOOKING_SCAN_FAILED'),
    );
    expect(failed.at(-1)).toMatchObject({ errorCode: 'OVERBOOKING_SCAN_FAILED' });
    expect(JSON.stringify(failed)).not.toMatch(/0900000129|token=/);
    expect(failed.at(-1)?.msg).toMatch(/^quét quá tải lỗi sau \d+ ms$/);

    // Payload sai hình dạng: bỏ qua có log, không đụng CSDL.
    find.mockClear();
    const invalid: typeof logs = [];
    await overbookingScanJob({ propertyIds: ['x'] }, context(db, invalid));
    expect(find).not.toHaveBeenCalled();
    expect(invalid).toEqual([
      {
        queue: OVERBOOKING_SCAN_QUEUE,
        msg: 'bỏ qua job sai hình dạng',
        errorCode: 'OVERBOOKING_JOB_INVALID',
      },
    ]);
    await db.$disconnect();
  });

  it('HB127_job_payload_and_meta_reach_handler', async () => {
    // BullMQ factory chuyển đủ job.data (kể cả eventId/key/version) + id/name cho handler có kiểu.
    const seen: { data: unknown; attempt: unknown; job: unknown }[] = [];
    const handler: JobHandler = (data, _context, attempt, job) => {
      seen.push({ data, attempt, job });
      return Promise.resolve();
    };
    let captured: ((job: JobLike) => Promise<void>) | undefined;
    const ctors: BullmqConstructors = {
      createQueue: (name) => fakeQueue(name, []),
      createWorker: (_name, _connection, _concurrency, run) => {
        captured = run;
        return { close: () => Promise.resolve() };
      },
    };
    const logs: { queue: QueueName; msg: string }[] = [];
    const db = unconnectedDb();
    const deps = createBullmqDeps(config(), createLogger('silent'), ctors, {
      handlers: { [OVERBOOKING_SCAN_QUEUE]: handler },
      context: context(db, logs),
    });
    deps.createWorker(OVERBOOKING_SCAN_QUEUE, () => Promise.resolve());
    const payload = { eventId: 'evt-1', key: 'idem-1', version: 3, nested: { a: [1, 2] } };
    await captured?.({
      id: 'j-9',
      name: OVERBOOKING_SCAN_JOB,
      data: payload,
      attemptsMade: 1,
      maxAttempts: 3,
    });
    expect(seen).toEqual([
      {
        data: payload,
        attempt: { attempt: 2, attempts: 3 },
        job: { id: 'j-9', name: OVERBOOKING_SCAN_JOB },
      },
    ]);
    // Có dispatch thật ⇒ factory cung cấp nguồn nhịp quét; không có dispatch ⇒ không.
    expect(deps.scanSchedule).toBeDefined();
    expect(createBullmqDeps(config(), createLogger('silent'), ctors).scanSchedule).toBeUndefined();
    await db.$disconnect();
  });
});
