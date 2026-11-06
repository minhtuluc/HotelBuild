/**
 * Module OVER (HB-125 + HB-126): planner/đóng ca, điều chuyển/walk-out, ghép phòng, chi bồi thường,
 * và đường đọc ca quá tải/cảnh báo lễ tân.
 *
 * `AuditWriter` (HB-009) ghi cùng transaction của use case; PIN/Idempotency/RBAC lấy từ module nền.
 * Use case phát hiện (`detection/index.ts`) được gọi trực tiếp từ scanner HB-127 và transaction F4
 * (D07) vì nó cần chính `tx` của caller; module này chỉ cấp tầng đọc HTTP.
 */
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../infrastructure/audit/audit-writer.js';
import { PRISMA } from '../../infrastructure/prisma/prisma.module.js';
import { CLOCK } from '../../infrastructure/ports.js';
import { CompensationAccess } from './compensation/access.js';
import { CompensationController } from './compensation/controller.js';
import { CompensationService } from './compensation/service.js';
import {
  MergeApproveAccess,
  MergeConsentAccess,
  MergeCreateAccess,
  MergeExecuteAccess,
} from './merges/access.js';
import { RoomMergeController } from './merges/controller.js';
import { RoomMergeService } from './merges/service.js';
import { MoveApproveAccess, MoveCreateAccess, MoveExecuteAccess } from './moves/access.js';
import { RoomMoveController } from './moves/controller.js';
import { RoomMoveService } from './moves/service.js';
import { overPermissions } from './permissions.js';
import { OverbookingResolveAccess, RelocationPlanAccess } from './planning/access.js';
import {
  OverbookingPlanningController,
  RelocationOptionsController,
} from './planning/controller.js';
import { RelocationOptionsService } from './planning/options.js';
import { OverbookingPlanningService } from './planning/service.js';
import { OverbookingAlertsController, OverbookingCasesController } from './queries/controller.js';
import { OverbookingQueries } from './queries/service.js';

@Module({
  controllers: [
    OverbookingPlanningController,
    RelocationOptionsController,
    RoomMoveController,
    RoomMergeController,
    CompensationController,
    OverbookingCasesController,
    OverbookingAlertsController,
  ],
  providers: [
    overPermissions,
    {
      provide: AuditWriter,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new AuditWriter(clock),
    },
    {
      provide: OverbookingQueries,
      inject: [PRISMA, CLOCK],
      useFactory: (db: PrismaClient, clock: Clock) => new OverbookingQueries(db, clock),
    },
    RelocationPlanAccess,
    OverbookingResolveAccess,
    MoveCreateAccess,
    MoveApproveAccess,
    MoveExecuteAccess,
    MergeCreateAccess,
    MergeConsentAccess,
    MergeApproveAccess,
    MergeExecuteAccess,
    CompensationAccess,
    OverbookingPlanningService,
    RelocationOptionsService,
    RoomMoveService,
    RoomMergeService,
    CompensationService,
  ],
})
export class OverModule {}
