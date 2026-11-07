/**
 * Provider Redis chờ kết nối sẵn sàng (có giới hạn) trước khi app nhận request.
 *
 * Lỗi gốc (HB-131 CI): client `enableOfflineQueue: false` trả về ngay khi vừa tạo, nên lệnh đầu tiên
 * (login đếm hạn mức IP) gặp `Stream isn't writeable…` ⇒ 500. Local Redis ở 127.0.0.1 kết nối đủ nhanh
 * để che lỗi; `localhost` trong container/CI thì không.
 */
import { Redis } from 'ioredis';
import { expect, test } from 'vitest';
import { connectRedis } from '../src/infrastructure/redis/redis.module.js';

const url = (): string => {
  const base = process.env['REDIS_URL'];
  if (!base) throw new Error('Cần Redis 7 (REDIS_URL); không có nhánh bỏ qua');
  return base;
};

test('connectRedis: trả về client đã sẵn sàng, lệnh đầu tiên chạy được ngay', async () => {
  const client = await connectRedis(url());
  try {
    expect(client.status).toBe('ready');
    await expect(client.ping()).resolves.toBe('PONG');
  } finally {
    client.disconnect();
  }
});

test('cùng cấu hình nhưng không chờ: lệnh ở tick đầu bị từ chối — đúng lỗi gây 500 khi login', async () => {
  const naive = new Redis(url(), {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    disableClientInfo: true,
  });
  naive.on('error', () => undefined);
  try {
    await expect(naive.ping()).rejects.toThrow(/Stream isn't writeable/);
  } finally {
    naive.disconnect();
  }
});

test('Redis không kết nối được: vẫn trả client sau thời hạn chờ (degrade như cũ, không treo app)', async () => {
  const started = performance.now();
  const client = await connectRedis('redis://127.0.0.1:1', 300);
  try {
    expect(performance.now() - started).toBeLessThan(3000);
    expect(client.status).not.toBe('ready');
  } finally {
    client.disconnect();
  }
});
