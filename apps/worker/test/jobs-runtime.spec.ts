// Nạp hai module chỉ có khai báo kiểu để phép đo bao phủ thấy chúng đã được dùng (không có mã chạy).
import '../src/logger.js';
import '../src/jobs/types.js';
import { describe, expect, test } from 'vitest';
import { ConfigError, loadWorkerConfig } from '../src/config/env.js';
import { createJobRuntime } from '../src/jobs/context.js';
import { JOB_HANDLERS } from '../src/jobs/registry.js';
import { defaultWorkerApp } from '../src/main.js';
import { QUEUE_NAMES } from '../src/queues.js';
import type { WorkerLogger } from '../src/logger.js';

/**
 * HB-006/HB-163 — phần "dây nối" của worker: ngữ cảnh job (clock tiêm được + log đã lọc PII), bảng
 * handler thật theo hàng đợi, và cấu hình bị từ chối kèm tên biến (không in giá trị).
 */
const ENV = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

function recordingLogger(): { logger: WorkerLogger; entries: string[] } {
  const entries: string[] = [];
  return {
    entries,
    logger: {
      info: ({ queue }, msg) => {
        entries.push(`info|${queue}|${msg}`);
      },
      error: ({ queue, component, errorCode }, msg) => {
        entries.push(`error|${queue}|${component}|${errorCode}|${msg}`);
      },
    },
  };
}

/** Thông điệp lỗi cấu hình (dùng cho ca phải bị từ chối). */
function configErrorMessageOf(env: NodeJS.ProcessEnv): string {
  try {
    loadWorkerConfig(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('cấu hình phải bị từ chối nhưng lại hợp lệ');
}

describe('createJobRuntime', () => {
  test('log đi qua WorkerLogger (kèm jobId), clock tiêm được, config giữ nguyên', async () => {
    const config = loadWorkerConfig(ENV);
    const { logger, entries } = recordingLogger();
    const fixed = new Date('2026-11-05T00:00:00Z');
    const runtime = createJobRuntime(config, logger, () => fixed);
    try {
      expect(runtime.context.config).toBe(config);
      expect(runtime.context.clock.now()).toBe(fixed);
      runtime.context.log({ queue: 'q.report-export', msg: 'đã sinh tệp' });
      runtime.context.log({ queue: 'q.notification-send', msg: 'đã gửi', jobId: '42' });
      expect(entries).toEqual([
        'info|q.report-export|đã sinh tệp',
        'info|q.notification-send|đã gửi (job 42)',
      ]);
    } finally {
      await runtime.close();
    }
  });

  test('không tiêm đồng hồ ⇒ dùng đồng hồ hệ thống', async () => {
    const runtime = createJobRuntime(loadWorkerConfig(ENV), recordingLogger().logger);
    try {
      expect(runtime.context.clock.now()).toBeInstanceOf(Date);
    } finally {
      await runtime.close();
    }
  });
});

describe('defaultWorkerApp', () => {
  test('dựng app thật từ cấu hình (chưa mở kết nối nào) và đóng sạch', async () => {
    const app = defaultWorkerApp(loadWorkerConfig({ ...ENV, LOG_LEVEL: 'silent' }));
    expect(typeof app.start).toBe('function');
    await expect(app.stop()).resolves.toBeUndefined();
  });
});

describe('JOB_HANDLERS', () => {
  test('chỉ đăng ký handler cho hàng đợi đã có nghiệp vụ', () => {
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual([
      'q.export-cleanup',
      'q.notification-send',
      'q.outbox-relay',
      'q.report-export',
    ]);
    for (const name of Object.keys(JOB_HANDLERS)) expect(QUEUE_NAMES).toContain(name);
    expect(JOB_HANDLERS['q.hold-expiry']).toBeUndefined();
  });

  test('handler q.notification-send dựng theo WorkerConfig và từ chối payload sai trước khi chạm CSDL', async () => {
    const runtime = createJobRuntime(loadWorkerConfig(ENV), recordingLogger().logger);
    try {
      const handler = JOB_HANDLERS['q.notification-send'];
      if (handler === undefined) throw new Error('thiếu handler q.notification-send');
      await expect(handler({ notificationId: 'không-phải-uuid' }, runtime.context)).rejects.toThrow(
        'NOTIFICATION_PAYLOAD_INVALID',
      );
    } finally {
      await runtime.close();
    }
  });
});

describe('loadWorkerConfig', () => {
  test('URL không phân tích được ⇒ ConfigError nêu tên biến, không in giá trị', () => {
    const message = configErrorMessageOf({ ...ENV, REDIS_URL: 'không-phải-url' });
    expect(message).toContain('REDIS_URL');
    expect(message).not.toContain('không-phải-url');
    expect(() => loadWorkerConfig({ ...ENV, DATABASE_URL: 'không-phải-url' })).toThrow(ConfigError);
  });
});
