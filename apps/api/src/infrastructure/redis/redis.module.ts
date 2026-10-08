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

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'end') return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

/** Redis dùng chung: một client cho toàn app, đóng cùng vòng đời ứng dụng. */
@Global()
@Module({})
export class RedisModule {
  static register(): DynamicModule {
    const provider: Provider = {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): RedisClient => {
        const client = new Redis(config.REDIS_URL, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        client.on('error', () => {
          // Lỗi kết nối được xử lý tại chỗ gọi (fallback deny/giới hạn), không làm sập tiến trình.
        });
        return client;
      },
    };
    return { module: RedisModule, providers: [provider, RedisLifecycle], exports: [REDIS] };
  }
}
