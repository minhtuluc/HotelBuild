/**
 * HB-236 — UC-RATE-04 khuyến mãi (SCR-29). api.md §2.4 công bố `GET` + `POST /promotions` và màn SCR-29 đã
 * dựng (HB-061), nhưng API thật chưa có tuyến: chỉ API giả của E2E phục vụ. Engine giá (HB-052/HB-199)
 * đọc bảng `promotions`, nên trước đây không ai tạo được khuyến mãi trên hệ thống thật.
 *
 * Khuyến mãi là cấu hình **toàn chuỗi**: phạm vi theo kênh và **mã** loại phòng, không theo cơ sở. Vì vậy
 * `propertyId` của truy vấn chỉ để kiểm phạm vi người đọc, không lọc dữ liệu.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
import type { PromotionQuery } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { page } from '../rate-plans/support.js';
import {
  isUniqueViolation,
  owner,
  reader,
  safeDatabaseError,
  sqlDate,
} from '../calendar/support.js';
import { promotionSnapshot, promotionSummary } from './projection.js';
import { promotionInvalid, type PromotionCreateInput } from './validation.js';

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
    } catch (error) {
      // `promotions.code` UNIQUE: mã đã tồn tại (kể cả mã INACTIVE) ⇒ lỗi nghiệp vụ, không 500.
      if (isUniqueViolation(error)) promotionInvalid([{ field: 'code', issue: 'DUPLICATE' }]);
      return safeDatabaseError(error);
    }
  }
}
