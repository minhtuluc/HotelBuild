/**
 * UC-RATE-02 — mùa & hệ số mùa (SCR-27).
 *
 * Mùa chồng lấn **được phép** (BR-RATE-05): tuyến này không chặn khoảng giao nhau, chỉ giữ lại danh
 * sách mùa cùng `priority` đang chồng để ghi vào `AuditLog` (và màn hình nhắc) — việc chọn mùa thắng
 * vẫn là của engine HB-052 theo `priority` → khoảng hẹp hơn → `createdAt` nhỏ hơn.
 */
import type { Prisma, PrismaClient, seasons } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
import type { SeasonQuery } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { conflict, page } from '../rate-plans/support.js';
import {
  configuration,
  configurationAll,
  dateOnly,
  isUniqueViolation,
  maskText,
  missing,
  owner,
  reader,
  safeDatabaseError,
  sqlDate,
} from '../calendar/support.js';
import { seasonSnapshot, seasonSummary } from './projection.js';
import { seasonCodeFor } from './catalogue.js';
import {
  seasonIssues,
  type SeasonChanges,
  type SeasonCreateInput,
  type SeasonUpdateInput,
} from './validation.js';

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
      const overlapping = await overlappingSamePriority(tx, input);
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
      await this.rateChanged(tx, row);
    } catch (error) {
      // `uq_seasons_scope_code_start`: cùng cơ sở, cùng mã suy ra, cùng ngày bắt đầu ⇒ đã có mùa đó.
      if (isUniqueViolation(error)) configuration('startDate', 'DUPLICATE_SEASON');
      return safeDatabaseError(error);
    }
  }

  /**
   * HB-241 (TD-06): sửa/ngừng mùa. Khoá dòng, so `If-Match`, gộp thay đổi rồi kiểm lại **toàn bộ** luật
   * của lệnh tạo trên bản gộp. Đổi `startDate` thì suy lại `code` như lệnh tạo. Mùa chồng lấn vẫn được
   * phép (BR-RATE-05) và được ghi vào audit. Báo giá/booking đã phát giữ snapshot; chỉ báo giá mới
   * đọc cấu hình mới (`status = 'ACTIVE'`).
   */
  async update(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    expected: bigint,
    input: SeasonUpdateInput,
  ): Promise<void> {
    owner(actor);
    try {
      await tx.$queryRaw`SELECT id FROM seasons WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.seasons.findUnique({ where: { id } });
      if (!before || before.property_id === null) throw missing();
      requireProperty(actor, before.property_id);
      if (before.version !== expected) throw conflict();
      const merged = mergedSeason(before, input.changes);
      const issues = seasonIssues(merged, merged.name);
      if (issues.length > 0) configurationAll(issues);
      const after = await tx.seasons.update({
        where: { id },
        data: {
          code: seasonCodeFor(merged.startDate),
          name: merged.name,
          start_date: sqlDate(merged.startDate),
          end_date: sqlDate(merged.endDate),
          multiplier: merged.multiplier,
          priority: merged.priority,
          weekend_surcharge_enabled: merged.weekendSurchargeEnabled,
          status: merged.status,
        },
      });
      const overlapping =
        merged.status === 'ACTIVE' ? await overlappingSamePriority(tx, merged, id) : [];
      await this.audit.record(tx, {
        actor,
        action: merged.status !== before.status ? `SEASON_${merged.status}` : 'SEASON_UPDATED',
        entityType: 'Season',
        entityId: id,
        beforeJson: seasonSnapshot(before),
        afterJson: {
          ...seasonSnapshot(after),
          overlappingSamePrioritySeasonIds: overlapping.map((season) => season.id),
        },
        reason: maskText(input.reason),
      });
      await this.rateChanged(tx, after);
    } catch (error) {
      if (isUniqueViolation(error)) configuration('startDate', 'DUPLICATE_SEASON');
      return safeDatabaseError(error);
    }
  }

  private async rateChanged(tx: Prisma.TransactionClient, row: seasons): Promise<void> {
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
          propertyId: row.property_id,
          version: Number(row.version),
        },
      },
    });
  }
}

/** Mùa `ACTIVE` gắn cơ sở, cùng `priority`, giao khoảng ngày (trừ chính mùa đang sửa). */
function overlappingSamePriority(
  tx: Prisma.TransactionClient,
  season: { readonly priority: number; readonly startDate: string; readonly endDate: string },
  exceptId?: string,
) {
  return tx.seasons.findMany({
    where: {
      status: 'ACTIVE',
      property_id: { not: null },
      priority: season.priority,
      start_date: { lte: sqlDate(season.endDate) },
      end_date: { gte: sqlDate(season.startDate) },
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
}

/** Bản hiện tại + thay đổi, cùng dạng với đầu vào lệnh tạo để dùng chung luật. */
function mergedSeason(row: seasons, changes: SeasonChanges) {
  return {
    name: changes.name ?? row.name,
    startDate: changes.startDate ?? dateOnly(row.start_date),
    endDate: changes.endDate ?? dateOnly(row.end_date),
    multiplier: changes.multiplier ?? Number(row.multiplier),
    priority: changes.priority ?? row.priority,
    weekendSurchargeEnabled: changes.weekendSurchargeEnabled ?? row.weekend_surcharge_enabled,
    status: changes.status ?? seasonStatus(row.status),
  };
}

function seasonStatus(value: string): 'ACTIVE' | 'INACTIVE' {
  return value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}
