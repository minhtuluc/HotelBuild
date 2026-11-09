/**
 * HB-229 — đóng `Queue` ngắn hạn lúc kết nối còn khởi tạo không được làm sập worker.
 *
 * BullMQ 5.81: `close()` khi `RedisConnection` còn `initializing` gỡ hết listener, sau đó `init()` bị
 * reject ("Connection is closed") và `error` phát ra không ai nghe ⇒ uncaught exception ⇒ tiến trình
 * thoát mã 1. k6 HB-184 (lượt 09/11/2026) bắt được worker chết giữa lượt, để lại 543 hold hết hạn chưa
 * giải phóng. Ca này mở 50 queue đồng thời (bước khởi tạo chậm lại) và đóng chúng ở các mốc 20–79 ms để rơi
 * vào khe `INFO` đang bay.
 *
 * Vitest báo lỗi uncaught là lượt chạy đỏ, nên chỉ cần đi hết vòng là đủ chứng minh.
 */
import { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { closeQueueSafely, redisOptions } from '../src/bullmq.factory.js';

const redisUrl = process.env.REDIS_URL;
const QUEUES = 50;
/** Mốc đóng (ms) phủ khe `INFO` đang bay trên máy dev/CI; mỗi mốc rải thêm 0–9 ms. */
const BASES = [20, 25, 30, 35, 40, 45, 50, 55, 60, 70];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.runIf(redisUrl !== undefined)('HB-229 đóng queue an toàn', () => {
  it('HB229_closing_short_lived_queues_during_init_does_not_crash', async () => {
    const url = new URL(redisUrl!);
    url.pathname = '/11';
    let closed = 0;
    for (const base of BASES) {
      await Promise.all(
        Array.from({ length: QUEUES }, async (_, i) => {
          const queue = new Queue(`hb229-race-${base}`, { connection: redisOptions(url.href) });
          queue.on('error', () => undefined);
          await pause(base + (i % 10));
          await closeQueueSafely(queue);
          closed += 1;
        }),
      );
      // Cho `init()` bị reject (nếu có) kịp phát `error` trước khi sang lượt sau.
      await pause(200);
    }
    expect(closed).toBe(QUEUES * BASES.length);
  }, 60_000);
});
