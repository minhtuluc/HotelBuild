/**
 * Prisma client dùng chung cho các module nghiệp vụ (HB-007). Thời gian/ID vẫn lấy qua `Clock`/`IdGenerator`,
 * Prisma chỉ là cổng truy cập dữ liệu.
 */
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { DynamicModule, Provider } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CONFIG } from '../../config/env.js';
import type { ApiConfig } from '../../config/env.js';

export const PRISMA = Symbol('PRISMA');

export type DatabaseClient = PrismaClient;

@Injectable()
class PrismaLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) readonly client: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}

/** Prisma dùng chung: một client cho toàn app, ngắt kết nối khi ứng dụng đóng. */
@Global()
@Module({})
export class PrismaModule {
  static register(): DynamicModule {
    const provider: Provider = {
      provide: PRISMA,
      inject: [CONFIG],
      useFactory: (config: ApiConfig): DatabaseClient =>
        new PrismaClient({ datasourceUrl: config.DATABASE_URL }),
    };
    return { module: PrismaModule, providers: [provider, PrismaLifecycle], exports: [PRISMA] };
  }
}
