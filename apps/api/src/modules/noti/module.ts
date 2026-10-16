import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PinoLogger } from 'nestjs-pino';
import { PRISMA } from '../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../infrastructure/ports.js';
import { AuditWriter } from '../../infrastructure/audit/audit-writer.js';
import { NotificationResendAccess } from './access.js';
import { NotificationsController } from './controller.js';
import { NotificationGateway } from './gateway.js';
import { notificationQueueProvider, NOTIFICATION_QUEUE } from './queue.js';
import type { NotificationQueuePort } from './queue.js';
import { notificationPermissions } from './permissions.js';
import { NotificationsService } from './service.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationResendAccess,
    notificationPermissions,
    notificationQueueProvider,
    {
      provide: NotificationGateway,
      inject: [PRISMA, CLOCK, NOTIFICATION_QUEUE, PinoLogger],
      useFactory: (
        db: PrismaClient,
        clock: Clock,
        queue: NotificationQueuePort,
        logger: PinoLogger,
      ) =>
        new NotificationGateway(db, clock, queue, {
          error: (entry) => logger.error(entry, 'không phát được job thông báo'),
        }),
    },
    {
      provide: NotificationsService,
      inject: [PRISMA, CLOCK, NotificationGateway],
      useFactory: (db: PrismaClient, clock: Clock, gateway: NotificationGateway) =>
        new NotificationsService(db, clock, new AuditWriter(clock), gateway),
    },
  ],
  exports: [NotificationGateway],
})
export class NotiModule {}
