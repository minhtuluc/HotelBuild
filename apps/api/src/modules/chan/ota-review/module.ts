import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { otaReviewPermissions } from './permissions.js';
import { OtaReviewService } from './service.js';
import { OtaReviewController } from './controller.js';
import { OtaReviewAccess } from './access.js';
import { OtaReviewETagInterceptor } from './etag-interceptor.js';

/**
 * HB-129 AC12. Module tách khỏi `chan/inbound` (use case áp inbox, không có HTTP) để worker chỉ nạp
 * phần áp sự kiện và API chỉ đăng ký đúng một tuyến soát trùng.
 */
@Module({
  controllers: [OtaReviewController],
  providers: [
    OtaReviewAccess,
    OtaReviewETagInterceptor,
    otaReviewPermissions,
    {
      provide: OtaReviewService,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) =>
        new OtaReviewService(db, clock, new AuditWriter(clock)),
    },
  ],
})
export class OtaReviewModule {}
