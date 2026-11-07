/**
 * Kết nối Redis dùng chung (ADR-004): giữ chỗ, hạn mức tần suất, đếm thất bại đăng nhập.
 * URL lấy từ `ApiConfig.REDIS_URL` nên **tôn trọng số DB trong URL** (test dùng DB riêng).
 */
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG } from '../../config/env.js';
import type { ApiConfig } from '../../config/env.js';

export const REDIS = Symbol('REDIS');

export type RedisClient = Redis;

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) readonly client: RedisClient) {}

  onApplicationShutdown(): void {
    if (this.client.status === 'end') return;
    this.client.disconnect();
  }
}

/** Redis dùng chung: một client cho toàn app, đóng cùng vòng đời ứng dụng. */
/** Chờ kết nối tối đa bấy nhiêu ms rồi vẫn khởi động (degrade như cũ khi Redis chết). */
export const REDIS_READY_WAIT_MS = 3000;

/**
 * Tạo client **đã kết nối** (hoặc hết thời gian chờ). Client dùng `enableOfflineQueue: false` để lệnh
 * không xếp hàng vô hạn khi Redis chết; hệ quả là lệnh gửi **trước** khi kết nối xong bị từ chối ngay
 * (`Stream isn't writeable…`) — request đầu tiên sau khi app mở cổng (login đếm hạn mức IP) trả 500 dù
 * Redis vẫn sống. Chờ `ready` có giới hạn loại bỏ cuộc đua đó mà không khiến app phụ thuộc cứng vào Redis.
 */
export async function connectRedis(
  url: string,
  waitMs: number = REDIS_READY_WAIT_MS,
): Promise<RedisClient> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    disableClientInfo: true,
  });
  client.on('error', () => {
    // Lỗi kết nối được xử lý tại chỗ gọi (fallback deny/giới hạn), không làm sập tiến trình.
  });
  if (client.status !== 'ready') {
    const settled = Promise.withResolvers<void>();
    const timer = setTimeout(settled.resolve, waitMs);
    client.once('ready', settled.resolve);
    await settled.promise;
    clearTimeout(timer);
    client.off('ready', settled.resolve);
  }
  return client;
}

/** Redis dùng chung: một client cho toàn app, đóng cùng vòng đời ứng dụng. */
@Global()
@Module({})
export class RedisModule {
  static register(): DynamicModule {
    const provider: Provider = {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): Promise<RedisClient> => connectRedis(config.REDIS_URL),
    };
    return { module: RedisModule, providers: [provider, RedisLifecycle], exports: [REDIS] };
  }
}
