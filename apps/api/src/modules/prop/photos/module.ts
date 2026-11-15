import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { PhotoReplaceAccess } from './access.js';
import { PhotosController } from './controller.js';
import { photoPermissions } from './permissions.js';
import { PhotosService } from './service.js';

@Module({
  controllers: [PhotosController],
  providers: [
    photoPermissions,
    PhotoReplaceAccess,
    {
      provide: PhotosService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) => new PhotosService(db, new AuditWriter(clock)),
    },
  ],
})
export class PhotosModule {}
