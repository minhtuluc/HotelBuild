/**
 * HB-182 — chống bắn trùng bằng Redis: mỗi `(điều kiện, đối tượng)` chỉ mở **một** cảnh báo trong cửa sổ
 * đọc từ `system_settings` (`alerts.*.dedupSeconds`). Chọn Redis thay vì bảng mới vì ticket cấm migration
 * và `notifications` không có cột đối tượng ổn định để so cửa sổ.
 *
 * `SET … NX EX` là thao tác nguyên tử nên hai lượt quét chồng nhau (BullMQ chạy lại, hai tiến trình worker)
 * vẫn chỉ một bên thắng. Redis hỏng thì **ném ra** (job thất bại và BullMQ thử lại) thay vì gửi không chặn —
 * mất Redis mà vẫn gửi là bắn trùng mỗi lượt quét.
 */
import { Redis } from 'ioredis';
import { redisOptions } from '../../bullmq.factory.js';

export interface AlertDedupStore {
  /** `true` khi lượt gọi này **giành** cửa sổ (khoá chưa tồn tại). */
  acquire(key: string, ttlSeconds: number): Promise<boolean>;
  /** Trả cửa sổ khi không ghi/phát được cảnh báo — lỗi tạm thời không được nuốt mất sự cố. */
  release(key: string): Promise<void>;
  close(): Promise<void>;
}

export function createAlertDedup(redisUrl: string): AlertDedupStore {
  const client = new Redis({
    ...redisOptions(redisUrl),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  // Kết nối **lười** nhưng phải xong trước lệnh đầu tiên (`enableOfflineQueue: false`); lỗi kết nối được
  // chuyển nguyên vẹn cho lượt gọi để job thất bại và BullMQ thử lại thay vì gửi không chặn.
  const ready = client.connect();
  void ready.catch(() => undefined);
  return {
    async acquire(key, ttlSeconds) {
      await ready;
      return (await client.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    },
    async release(key) {
      await client.del(key);
    },
    async close() {
      client.disconnect();
    },
  };
}
