/**
 * UC-RATE-02 — mùa & hệ số mùa (SCR-27).
 *
 * Mùa chồng lấn **được phép** (BR-RATE-05): tuyến này không chặn khoảng giao nhau, chỉ giữ lại danh
 * sách mùa cùng `priority` đang chồng để ghi vào `AuditLog` (và màn hình nhắc) — việc chọn mùa thắng
 * vẫn là của engine HB-052 theo `priority` → khoảng hẹp hơn → `createdAt` nhỏ hơn.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
import type { SeasonQuery } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { page } from '../rate-plans/support.js';
import {
  configuration,
  isUniqueViolation,
  missing,
  owner,
  reader,
  safeDatabaseError,
  sqlDate,
} from '../calendar/support.js';
import { seasonSnapshot, seasonSummary } from './projection.js';
import type { SeasonCreateInput } from './validation.js';

export class SeasonsService {
  constructor(
    readonly db: PrismaClient,
    readonly ids: IdGenerator,
    readonly audit: AuditWriter,
  ) {}

  async list(actor: AuthorizedActor, query: SeasonQuery) {
    reader(actor);
    if (query.propertyId !== undefined) requireProperty(actor, query.propertyId);
    const where: Prisma.seasonsWhereInput = {
      property_id:
        query.propertyId !== undefined
          ? query.propertyId
          : actor.isOwner()
            ? { not: null }
            : { in: [...actor.propertyScope] },
      ...(query.from === undefined ? {} : { end_date: { gte: sqlDate(query.from) } }),
      ...(query.to === undefined ? {} : { start_date: { lte: sqlDate(query.to) } }),
    };
    // Một ảnh chụp cho cả `total` lẫn trang dữ liệu để mùa đang thêm không chen vào giữa hai truy vấn.
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.seasons.count({ where });
        const rows = await tx.seasons.findMany({
          where: { ...where, ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }) },
          orderBy: { id: 'asc' },
          take: query.limit + 1,
        });
        return page(rows, total, query, seasonSummary);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    input: SeasonCreateInput,
  ): Promise<void> {
    owner(actor);
    try {
      const property = await tx.properties.findUnique({
        where: { id: input.propertyId },
        select: { id: true },
      });
      if (!property) throw missing();
      requireProperty(actor, input.propertyId);
      const overlapping = await tx.seasons.findMany({
        where: {
          status: 'ACTIVE',
          property_id: { not: null },
          priority: input.priority,
          start_date: { lte: sqlDate(input.endDate) },
          end_date: { gte: sqlDate(input.startDate) },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const row = await tx.seasons.create({
        data: {
          property_id: input.propertyId,
          code: input.code,
          name: input.name,
          start_date: sqlDate(input.startDate),
          end_date: sqlDate(input.endDate),
          multiplier: input.multiplier,
          priority: input.priority,
          weekend_surcharge_enabled: input.weekendSurchargeEnabled,
        },
      });
      await this.audit.record(tx, {
        actor,
        action: 'SEASON_CREATED',
        entityType: 'Season',
        entityId: row.id,
        beforeJson: null,
        afterJson: {
          ...seasonSnapshot(row),
          overlappingSamePrioritySeasonIds: overlapping.map((season) => season.id),
        },
        reason: null,
      });
      await tx.outbox_events.create({
        data: {
          id: this.ids.generate(),
          event_type: 'RateChanged',
          aggregate_type: 'Season',
          aggregate_id: row.id,
          payload_json: {
            schemaVersion: 1,
            entityType: 'Season',
            entityId: row.id,
            propertyId: input.propertyId,
            version: Number(row.version),
          },
        },
      });
    } catch (error) {
      // `uq_seasons_scope_code_start`: cùng cơ sở, cùng mã suy ra, cùng ngày bắt đầu ⇒ đã có mùa đó.
      if (isUniqueViolation(error)) configuration('startDate', 'DUPLICATE_SEASON');
      return safeDatabaseError(error);
    }
  }
}
