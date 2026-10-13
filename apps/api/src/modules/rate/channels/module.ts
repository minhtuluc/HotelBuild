import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { ChannelsController } from './controller.js';
import { ChannelsService } from './service.js';
@Module({
  controllers: [ChannelsController],
  providers: [
    permissionProvider('channels', { 'channels.read': ['MANAGER', 'OWNER'] }),
    {
      provide: ChannelsService,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => new ChannelsService(db),
    },
  ],
})
export class ChannelsModule {}
