import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { QuotesMultiChannelController } from './controller.js';
import { QuotesMultiChannelService } from './service.js';

@Module({
  controllers: [QuotesMultiChannelController],
  providers: [
    permissionProvider('quotes', { 'quotes.multiChannel': ['MANAGER', 'OWNER'] }),
    {
      provide: QuotesMultiChannelService,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => new QuotesMultiChannelService(db),
    },
  ],
})
export class QuotesMultiChannelModule {}
