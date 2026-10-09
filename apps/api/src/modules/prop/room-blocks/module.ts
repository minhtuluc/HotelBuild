import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { RoomBlocksController } from './controller.js';
import { RoomBlocksService } from './service.js';
import { RoomBlockAccess } from './access.js';
import { roomBlockPermissions } from './permissions.js';
@Module({
  controllers: [RoomBlocksController],
  providers: [
    RoomBlockAccess,
    roomBlockPermissions,
    {
      provide: RoomBlocksService,
      inject: [PRISMA, CLOCK, ID_GENERATOR],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator) =>
        new RoomBlocksService(db, clock, ids, new AuditWriter(clock)),
    },
  ],
  exports: [RoomBlocksService],
})
export class RoomBlocksModule {}
