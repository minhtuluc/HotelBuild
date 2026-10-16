import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { REDIS } from '../../../infrastructure/redis/redis.module.js';
import type { RedisClient } from '../../../infrastructure/redis/redis.module.js';
import { QuoteAccess } from './access.js';
import { QuotesController } from './controller.js';
import { RateQuoteService } from './service.js';
import { RateQuoteStore } from './store.js';

/**
 * `POST /quotes` (HB-074). Xuất `RateQuoteService` để HB-076 (giữ chỗ) và HB-077 (đặt phòng) tiêu thụ
 * quote qua `consume` mà không lặp lại luật principal/fingerprint/hạn dùng.
 */
@Module({
  controllers: [QuotesController],
  providers: [
    QuoteAccess,
    {
      provide: RateQuoteStore,
      inject: [REDIS],
      useFactory: (redis: RedisClient) => new RateQuoteStore(redis),
    },
    {
      provide: RateQuoteService,
      inject: [PRISMA, RateQuoteStore, ID_GENERATOR, CLOCK],
      useFactory: (db: PrismaClient, store: RateQuoteStore, ids: IdGenerator, clock: Clock) =>
        new RateQuoteService(db, store, ids, clock),
    },
  ],
  exports: [RateQuoteService],
})
export class QuotesModule {}
