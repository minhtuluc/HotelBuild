/**
 * HB-129 AC13 — worker **chạy từ dist** với composition runtime HB-127 (giai đoạn A, đỏ có chủ đích).
 *
 * Ca duy nhất: build workspace (`@pinehill/api` + `@pinehill/worker`), khởi động
 * `node --conditions=pinehill-dist dist/main.js` với CSDL/Redis thật, đẩy một job `q.ota-inbox` mang
 * `job.data.eventId` cho một hàng inbox đã bền, và chứng minh worker xử lý đúng hàng đó.
 *
 * Đồng thời khoá ba điều kiện build/runtime:
 * - không có import tương đối `apps/api/src` trong dist của worker (dùng package subpath/điều kiện
 *   `pinehill-dist`, không chép transaction áp booking);
 * - log của tiến trình không chứa payload/PII (họ tên/SĐT khách);
 * - SIGTERM dừng êm, thoát mã 0 (HB-006).
 */
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { expect, test } from 'vitest';
import { redisOptions } from '../../src/bullmq.factory.js';
import {
  OTA_INBOX_QUEUE,
  REFERENCE,
  createOtaTestDb,
  insertInbox,
  seedWorkerReference,
  testRedisUrl,
} from './fixture.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

function buildWorkspace(): void {
  // Build cả gói nền trước: dist của worker import `@pinehill/*` qua package subpath, không có
  // `tsc` nào tự build dependency. Checkout CI sạch không có dist sẵn.
  for (const filter of [
    '@pinehill/contracts',
    '@pinehill/domain',
    '@pinehill/api',
    '@pinehill/worker',
  ]) {
    const built = spawnSync('pnpm', ['--filter', filter, 'build'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env },
    });
    expect(built.status, `${filter} build\n${built.stderr}\n${built.stdout}`).toBe(0);
  }
}

/** Dist của worker không được trỏ về source API bằng đường dẫn tương đối. */
function assertNoApiSourceImports(directory: string): void {
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        pending.push(full);
        continue;
      }
      if (!entry.endsWith('.js')) continue;
      // Chỉ xét **specifier** của import/require: docblock trong dist nhắc tới `apps/api/src` là
      // chính sách, không phải phụ thuộc. Quét cả văn bản sẽ đỏ vô căn cứ.
      const content = readFileSync(full, 'utf8');
      const specifiers = [
        ...content.matchAll(/\b(?:from|require|import)\s*\(?\s*['"]([^'"]+)['"]/g),
      ].map((match) => match[1]!);
      for (const specifier of specifiers) expect(specifier, full).not.toContain('apps/api/src');
    }
  }
}

async function waitForProcessed(
  rows: (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>,
  eventId: string,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const [row] = await rows('SELECT status FROM webhook_inbox WHERE event_id=$1', [eventId]);
    if (row?.status === 'PROCESSED') return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
  }
  throw new Error(`HB129 dist worker không xử lý ${eventId} trong 60s\n${logs()}`);
}

test('built_runtime_applies_persisted_inbox', async () => {
  buildWorkspace();
  const testDb = await createOtaTestDb('runtime');
  const eventId = 'hb129-dist-1';
  const queue = new Queue(OTA_INBOX_QUEUE, { connection: redisOptions(testRedisUrl()) });
  let captured = '';
  const worker = spawn(process.execPath, ['--conditions=pinehill-dist', 'dist/main.js'], {
    cwd: join(root, 'apps/worker'),
    env: {
      ...process.env,
      DATABASE_URL: testDb.ownerUrl,
      REDIS_URL: testRedisUrl(),
      LOG_LEVEL: 'info',
      ENABLE_REPEATABLE_SCHEDULERS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (chunk: Buffer) => {
    captured += chunk.toString('utf8');
  });
  worker.stderr.on('data', (chunk: Buffer) => {
    captured += chunk.toString('utf8');
  });
  try {
    await seedWorkerReference(testDb.rows);
    await insertInbox(testDb.rows, { eventId, code: 'HB129-DIST-1' });
    await queue.add(
      'ota-inbox',
      { eventId },
      { jobId: `hb129-dist-${eventId}`, attempts: 1, removeOnComplete: false },
    );
    await waitForProcessed(testDb.rows, eventId, () => captured);
    const marks = await testDb.rows(
      'SELECT provider_booking_code FROM channel_cancel_tombstones WHERE provider_booking_code=$1',
      ['HB129-DIST-1'],
    );
    expect(marks).toHaveLength(1);
    expect(await testDb.rows('SELECT id FROM bookings')).toHaveLength(0);
    expect(captured).not.toContain(REFERENCE.guestPhone);
    expect(captured).not.toContain(REFERENCE.guestName);
    assertNoApiSourceImports(join(root, 'apps/worker/dist'));
    const exited = Promise.withResolvers<number | null>();
    worker.once('exit', (code) => exited.resolve(code));
    worker.kill('SIGTERM');
    expect(await exited.promise).toBe(0);
  } finally {
    if (worker.exitCode === null) worker.kill('SIGKILL');
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await testDb.close();
  }
}, 300000);
