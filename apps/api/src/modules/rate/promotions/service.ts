/**
 * HB-236 — UC-RATE-04 khuyến mãi (SCR-29). api.md §2.4 công bố `GET` + `POST /promotions` và màn SCR-29 đã
 * dựng (HB-061), nhưng API thật chưa có tuyến: chỉ API giả của E2E phục vụ. Engine giá (HB-052/HB-199)
 * đọc bảng `promotions`, nên trước đây không ai tạo được khuyến mãi trên hệ thống thật.
 *
 * Khuyến mãi là cấu hình **toàn chuỗi**: phạm vi theo kênh và **mã** loại phòng, không theo cơ sở. Vì vậy
 * `propertyId` của truy vấn chỉ để kiểm phạm vi người đọc, không lọc dữ liệu.
 */
import type { Prisma, PrismaClient, promotions } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
import type { PromotionQuery } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { page } from '../rate-plans/support.js';
import {
  dateOnly,
  isUniqueViolation,
  owner,
  reader,
  safeDatabaseError,
  sqlDate,
} from '../calendar/support.js';
import { conflict, maskText, missing } from '../rate-plans/support.js';
import { promotionSnapshot, promotionSummary } from './projection.js';
import {
  promotionInvalid,
  ruleIssues,
  type PromotionChanges,
  type PromotionCreateInput,
  type PromotionUpdateInput,
} from './validation.js';

export class PromotionsService {
  constructor(
    readonly db: PrismaClient,
    readonly ids: IdGenerator,
    readonly audit: AuditWriter,
  ) {}

  async list(actor: AuthorizedActor, query: PromotionQuery) {
    reader(actor);
    if (query.propertyId !== undefined) requireProperty(actor, query.propertyId);
    const where: Prisma.promotionsWhereInput =
      query.status === undefined ? {} : { status: query.status };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.promotions.count({ where });
        const rows = await tx.promotions.findMany({
          where: { ...where, ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }) },
          orderBy: { id: 'asc' },
          take: query.limit + 1,
        });
        return page(rows, total, query, promotionSummary);
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    input: PromotionCreateInput,
  ): Promise<void> {
    owner(actor);
    try {
      const row = await tx.promotions.create({
        data: {
          code: input.code,
          name: input.code,
          type: input.type,
          value: input.value,
          min_nights: input.minNights,
          channel_scope: [...input.channelScope],
          room_type_scope: [...input.roomTypeScope],
          valid_from: sqlDate(input.validFrom),
          valid_to: sqlDate(input.validTo),
          max_uses: input.maxUses,
          stackable: input.stackable,
        },
      });
      await this.audit.record(tx, {
        actor,
        action: 'PROMOTION_CREATED',
        entityType: 'Promotion',
        entityId: row.id,
        beforeJson: null,
        afterJson: promotionSnapshot(row),
        reason: null,
      });
      await this.rateChanged(tx, row);
    } catch (error) {
      // `promotions.code` UNIQUE: mã đã tồn tại (kể cả mã INACTIVE) ⇒ lỗi nghiệp vụ, không 500.
      if (isUniqueViolation(error)) promotionInvalid([{ field: 'code', issue: 'DUPLICATE' }]);
      return safeDatabaseError(error);
    }
  }

  /**
   * HB-240 (TD-08): sửa/ngừng. Khoá dòng, so `If-Match`, gộp thay đổi vào bản hiện tại rồi kiểm **toàn
   * bộ** luật như lệnh tạo trên bản gộp (ví dụ chỉ dời `validTo` vẫn phải ≥ `validFrom` đang lưu).
   * Báo giá/booking đã phát giữ snapshot cũ; chỉ báo giá mới đọc cấu hình mới (`status = 'ACTIVE'`).
   */
  async update(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    id: string,
    expected: bigint,
    input: PromotionUpdateInput,
  ): Promise<void> {
    owner(actor);
    try {
      await tx.$queryRaw`SELECT id FROM promotions WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await tx.promotions.findUnique({ where: { id } });
      if (!before) throw missing();
      if (before.version !== expected) throw conflict();
      const merged = mergedPromotion(before, input.changes);
      const issues = ruleIssues(merged);
      if (merged.maxUses !== null && merged.maxUses < before.used_count)
        issues.push({ field: 'maxUses', issue: 'BELOW_USED' });
      if (issues.length > 0) promotionInvalid(issues);
      const after = await tx.promotions.update({
        where: { id },
        data: {
          value: merged.value,
          min_nights: merged.minNights,
          channel_scope: [...merged.channelScope],
          room_type_scope: [...merged.roomTypeScope],
          valid_from: sqlDate(merged.validFrom),
          valid_to: sqlDate(merged.validTo),
          max_uses: merged.maxUses,
          stackable: merged.stackable,
          status: merged.status,
        },
      });
      await this.audit.record(tx, {
        actor,
        action:
          merged.status !== before.status ? `PROMOTION_${merged.status}` : 'PROMOTION_UPDATED',
        entityType: 'Promotion',
        entityId: id,
        beforeJson: promotionSnapshot(before),
        afterJson: promotionSnapshot(after),
        reason: maskText(input.reason),
      });
      await this.rateChanged(tx, after);
    } catch (error) {
      return safeDatabaseError(error);
    }
  }

  private async rateChanged(tx: Prisma.TransactionClient, row: promotions): Promise<void> {
    await tx.outbox_events.create({
      data: {
        id: this.ids.generate(),
        event_type: 'RateChanged',
        aggregate_type: 'Promotion',
        aggregate_id: row.id,
        payload_json: {
          schemaVersion: 1,
          entityType: 'Promotion',
          entityId: row.id,
          version: Number(row.version),
        },
      },
    });
  }
}

function promotionType(value: string): 'PERCENT' | 'AMOUNT' {
  return value === 'PERCENT' ? 'PERCENT' : 'AMOUNT';
}

/** Bản hiện tại + thay đổi, cùng dạng với đầu vào lệnh tạo để dùng chung luật. */
function mergedPromotion(row: promotions, changes: PromotionChanges) {
  return {
    type: promotionType(row.type),
    value: changes.value ?? Number(row.value),
    minNights: changes.minNights ?? row.min_nights,
    channelScope: changes.channelScope ?? row.channel_scope,
    roomTypeScope: changes.roomTypeScope ?? row.room_type_scope,
    validFrom: changes.validFrom ?? dateOnly(row.valid_from),
    validTo: changes.validTo ?? dateOnly(row.valid_to),
    ...mergedTerms(row, changes),
  };
}

function mergedTerms(row: promotions, changes: PromotionChanges) {
  return {
    maxUses: changes.maxUses === undefined ? row.max_uses : changes.maxUses,
    stackable: changes.stackable ?? row.stackable,
    status: changes.status ?? promotionStatus(row.status),
  };
}

function promotionStatus(value: string): 'ACTIVE' | 'INACTIVE' {
  return value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}
