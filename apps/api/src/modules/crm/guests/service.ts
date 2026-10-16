import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import {
  loyaltyTierSchema,
  type GuestAnonymizeRequest,
  type GuestBlacklistRequest,
  type GuestCreateRequest,
  type GuestLoyalty,
  type GuestQuery,
  type GuestSummary,
  type ListPage,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty, ScopeDeniedError } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { maskOperationalText } from '../../prop/room-blocks/operational-text.js';
import { forbidden, missing } from '../../sys/settings/validation.js';
import { ANONYMIZED_NOTE, anonymizeData, maskAnonymizeReason } from './anonymize.js';
import { countedStayStatuses, windowStartDate } from './loyalty.js';
import { auditGuest, guestAdminSelect, guestSelect, project } from './projection.js';

const staff = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'];

/** api.md §6.3 (dòng "Blacklist/ẩn danh hoá"): thao tác quản trị hồ sơ chỉ MANAGER/OWNER. */
const managers = ['MANAGER', 'OWNER'];

export interface GuestCreateResult {
  readonly summary: GuestSummary;
  /** `false` khi SĐT đã có hồ sơ — trả hồ sơ cũ, không tạo bản thứ hai (BR-CRM-01). */
  readonly created: boolean;
}

/**
 * UC-CRM-01 — tra cứu/tạo hồ sơ khách tại quầy. Kết quả tìm **chỉ** gồm khách có booking trong cơ sở
 * thuộc phạm vi người gọi (BR-RBAC-02); hồ sơ chưa phát sinh booking chỉ trả về ngay cho người vừa tạo.
 */
export class GuestsService {
  constructor(
    readonly db: PrismaClient,
    readonly clock: Clock,
    readonly audit: AuditWriter,
  ) {}

  private visible(actor: AuthorizedActor, query: GuestQuery): Prisma.guestsWhereInput {
    return {
      AND: [
        actor.role === 'OWNER'
          ? {}
          : { bookings: { some: { property_id: { in: [...actor.propertyScope] } } } },
        query.propertyId === undefined
          ? {}
          : { bookings: { some: { property_id: query.propertyId } } },
        query.q === undefined
          ? {}
          : {
              OR: [
                { full_name: { contains: query.q, mode: 'insensitive' } },
                { phone: { contains: query.q } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            },
        query.loyaltyTier === undefined ? {} : { loyalty_tier: query.loyaltyTier },
        query.blacklisted === undefined ? {} : { blacklisted: query.blacklisted },
      ],
    };
  }

  async search(actor: AuthorizedActor, query: GuestQuery): Promise<ListPage<GuestSummary>> {
    if (!staff.includes(actor.role)) throw forbidden();
    if (query.propertyId !== undefined) requireProperty(actor, query.propertyId);
    const where = this.visible(actor, query);
    if (actor.role !== 'OWNER' && actor.propertyScope.length === 0)
      return { data: [], meta: { limit: query.limit, nextCursor: null, hasMore: false, total: 0 } };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.guests.count({ where });
        const after = query.cursor === undefined ? undefined : await this.cursor(tx, query.cursor);
        const rows = await tx.guests.findMany({
          where: after === undefined ? where : { AND: [where, after] },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
          select: guestSelect,
        });
        const hasMore = rows.length > query.limit;
        const data = (hasMore ? rows.slice(0, query.limit) : rows).map(project);
        return {
          data,
          meta: {
            limit: query.limit,
            hasMore,
            nextCursor: hasMore ? data.at(-1)!.id : null,
            total,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  /** Cursor là `id`; điều kiện trả về so theo cặp `(created_at, id)` để trang không nhảy bản ghi. */
  private async cursor(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Prisma.guestsWhereInput | undefined> {
    const row = await tx.guests.findUnique({ where: { id }, select: { created_at: true } });
    if (row === null) return undefined;
    return {
      OR: [
        { created_at: { lt: row.created_at } },
        { AND: [{ created_at: row.created_at }, { id: { lt: id } }] },
      ],
    };
  }

  /**
   * Chặn trả hồ sơ đã có khi khách **chỉ** thuộc cơ sở ngoài phạm vi người gọi (api.md §6.3).
   * Hồ sơ chưa phát sinh booking vẫn trả lại: quầy cần tra lại ngay sau khi tạo.
   */
  private async assertReachable(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    guestId: string,
  ): Promise<void> {
    if (actor.role === 'OWNER') return;
    const [total, scoped] = await Promise.all([
      tx.bookings.count({ where: { guest_id: guestId } }),
      tx.bookings.count({
        where: { guest_id: guestId, property_id: { in: [...actor.propertyScope] } },
      }),
    ]);
    if (total > 0 && scoped === 0) throw new ScopeDeniedError();
  }

  /**
   * Đọc hồ sơ cho thao tác quản trị (ẩn danh hoá, loyalty, danh sách đen): không có → `404 E_GEN_NOT_FOUND`,
   * rồi `assertReachable` chặn hồ sơ **chỉ** thuộc cơ sở ngoài phạm vi → `403 E_AUTH_OUT_OF_SCOPE`.
   * Hồ sơ chưa phát sinh booking vẫn thao tác được, đúng quy ước sẵn có của module (README mục 3).
   */
  private async manageableGuest(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    guestId: string,
  ): Promise<Prisma.guestsGetPayload<{ select: typeof guestAdminSelect }>> {
    const row = await tx.guests.findUnique({ where: { id: guestId }, select: guestAdminSelect });
    if (row === null) throw missing();
    await this.assertReachable(tx, actor, guestId);
    return row;
  }

  /** Chèn hồ sơ mới; `undefined` khi SĐT đã có hồ sơ chưa ẩn danh (`uq_guests_phone` từng phần). */
  private async insertGuest(
    tx: Prisma.TransactionClient,
    input: GuestCreateRequest,
  ): Promise<string | undefined> {
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO guests(full_name,phone,email,id_number,dob,nationality,gender,consent_marketing,
                         consent_at,consent_version,notes)
      VALUES(${input.fullName},${input.phone},${input.email ?? null},${input.idNumber ?? null},
             ${input.dob === undefined ? null : input.dob}::date,${input.nationality ?? 'VN'},
             ${input.gender ?? 'UNSPECIFIED'},${input.consentMarketing},
             ${input.consentMarketing ? this.clock.now() : null},${input.consentVersion},
             ${input.note ?? null})
      ON CONFLICT (phone) WHERE anonymized_at IS NULL DO NOTHING
      RETURNING id`;
    return inserted[0]?.id;
  }

  async create(actor: AuthorizedActor, input: GuestCreateRequest): Promise<GuestCreateResult> {
    if (!staff.includes(actor.role)) throw forbidden();
    return this.db.$transaction(async (tx) => {
      // Hai lễ tân bấm cùng lúc: chỉ mục duy nhất từng phần cho đúng một bản ghi thắng, bản kia nhận
      // hồ sơ đã có (BR-CRM-01).
      const inserted = await this.insertGuest(tx, input);
      const id =
        inserted ??
        (
          await tx.guests.findFirstOrThrow({
            where: { phone: input.phone, anonymized_at: null },
            select: { id: true },
          })
        ).id;
      const summary = project(
        await tx.guests.findUniqueOrThrow({ where: { id }, select: guestSelect }),
      );
      if (inserted === undefined) {
        await this.assertReachable(tx, actor, id);
        return { summary, created: false };
      }
      await this.audit.record(tx, {
        actor,
        action: 'GUEST_CREATED',
        entityType: 'Guest',
        entityId: summary.id,
        beforeJson: null,
        afterJson: auditGuest(summary),
        reason: null,
      });
      return { summary, created: true };
    });
  }

  /**
   * UC-CRM-01 / BR-CRM-05, NFR-COMP-01/02 — ẩn danh hoá hồ sơ theo yêu cầu khách, không xoá cứng.
   *
   * Idempotent: lượt gọi thứ hai (kể cả chạy song song) thấy `anonymized_at` đã có thì trả nguyên hồ sơ,
   * **không** ghi lại cột nào và **không** thêm bản ghi nhật ký. Điều kiện `anonymized_at IS NULL` nằm
   * ngay trong lệnh ghi nên chỉ một lượt thắng.
   */
  async anonymize(
    actor: AuthorizedActor,
    guestId: string,
    input: GuestAnonymizeRequest,
  ): Promise<GuestSummary> {
    if (!managers.includes(actor.role)) throw forbidden();
    return this.db.$transaction(async (tx) => {
      const row = await this.manageableGuest(tx, actor, guestId);
      const before = project(row);
      const at = this.clock.now();
      const written = await tx.guests.updateMany({
        where: { id: guestId, anonymized_at: null },
        data: anonymizeData(row.blacklisted, at),
      });
      if (written.count === 0)
        return project(
          await tx.guests.findUniqueOrThrow({ where: { id: guestId }, select: guestSelect }),
        );
      // Ghi chú và lý do điều chỉnh điểm là văn bản tự do có thể chứa PII → thay nội dung, giữ bản ghi
      // (BR-CRM-05: ẩn danh hoá cùng hồ sơ, không xoá cứng).
      await tx.guest_notes.updateMany({
        where: { guest_id: guestId },
        data: { content: ANONYMIZED_NOTE },
      });
      await tx.loyalty_transactions.updateMany({
        where: { guest_id: guestId, reason: { not: null } },
        data: { reason: null },
      });
      const after = project(
        await tx.guests.findUniqueOrThrow({ where: { id: guestId }, select: guestSelect }),
      );
      await this.audit.record(tx, {
        actor,
        action: 'GUEST_ANONYMIZED',
        entityType: 'Guest',
        entityId: guestId,
        // `auditGuest` che `fullName` (AuditWriter chưa che trường này); `AuditWriter` che `phone`/`email`.
        // Hồ sơ xử lý yêu cầu chủ thể dữ liệu gồm cả mốc yêu cầu khách báo và mốc ẩn danh hoá máy chủ đặt.
        beforeJson: auditGuest(before, { anonymizedAt: null }),
        afterJson: auditGuest(after, {
          anonymizedAt: at.toISOString(),
          requestedAt: input.requestedAt,
        }),
        // Lý do tự do không được giữ lại tên khách vừa bị xoá khỏi hồ sơ (BR-CRM-05, NFR-COMP-01).
        reason: maskAnonymizeReason(input.reason, row.full_name),
      });
      return after;
    });
  }

  /**
   * UC-CRM-02 / BR-CRM-02,03,06 — hạng, điểm và số đêm tích luỹ 12 tháng gần nhất.
   * Hạng/điểm đọc từ cột hồ sơ (luồng tích điểm sau check-out ghi); số đêm tính từ booking **đã ở thực tế**
   * (`CHECKED_IN`/`CHECKED_OUT`) có `check_in` trong cửa sổ 12 tháng — booking huỷ/no-show không cộng.
   */
  async loyalty(actor: AuthorizedActor, guestId: string): Promise<GuestLoyalty> {
    if (!staff.includes(actor.role)) throw forbidden();
    return this.db.$transaction(async (tx) => {
      const row = await this.manageableGuest(tx, actor, guestId);
      const stays = await tx.$queryRaw<{ nights: number }[]>`
        SELECT COALESCE(sum(nights), 0)::int AS nights
          FROM bookings
         WHERE guest_id = ${guestId}::uuid
           AND status = ANY(${[...countedStayStatuses]}::text[])
           AND check_in >= ${windowStartDate(this.clock.now())}::date`;
      return {
        guestId,
        loyaltyTier: loyaltyTierSchema.parse(row.loyalty_tier),
        loyaltyPoints: row.loyalty_points,
        staysLast12Months: stays[0]?.nights ?? 0,
        totalStays: row.total_stays,
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }

  /**
   * UC-CRM-03 / BR-CRM-04 — đưa khách vào danh sách đen kèm lý do bắt buộc; lý do vào nhật ký.
   * Lặp lại đúng trạng thái + lý do đang có là no-op (không sinh nhật ký thứ hai).
   */
  async blacklist(
    actor: AuthorizedActor,
    guestId: string,
    input: GuestBlacklistRequest,
  ): Promise<GuestSummary> {
    if (!managers.includes(actor.role)) throw forbidden();
    const reason = maskOperationalText(input.blacklistReason);
    return this.db.$transaction(async (tx) => {
      const row = await this.manageableGuest(tx, actor, guestId);
      const before = project(row);
      if (row.blacklisted && row.blacklist_reason === reason) return before;
      const after = project(
        await tx.guests.update({
          where: { id: guestId },
          data: { blacklisted: true, blacklist_reason: reason },
          select: guestSelect,
        }),
      );
      await this.audit.record(tx, {
        actor,
        action: 'GUEST_BLACKLISTED',
        entityType: 'Guest',
        entityId: guestId,
        beforeJson: auditGuest(before),
        afterJson: auditGuest(after),
        reason,
      });
      return after;
    });
  }

  /**
   * UC-CRM-03 / BR-CRM-04,05 — gỡ khỏi danh sách đen kèm lý do (api.md §2.10, trả `204`).
   * Khách vốn không bị chặn là no-op, không ghi nhật ký.
   */
  async releaseBlacklist(actor: AuthorizedActor, guestId: string, reason: string): Promise<void> {
    if (!managers.includes(actor.role)) throw forbidden();
    const masked = maskOperationalText(reason);
    await this.db.$transaction(async (tx) => {
      const row = await this.manageableGuest(tx, actor, guestId);
      if (!row.blacklisted) return;
      const before = project(row);
      const after = project(
        await tx.guests.update({
          where: { id: guestId },
          data: { blacklisted: false, blacklist_reason: null },
          select: guestSelect,
        }),
      );
      await this.audit.record(tx, {
        actor,
        action: 'GUEST_BLACKLIST_RELEASED',
        entityType: 'Guest',
        entityId: guestId,
        beforeJson: auditGuest(before),
        afterJson: auditGuest(after),
        reason: masked,
      });
    });
  }
}
