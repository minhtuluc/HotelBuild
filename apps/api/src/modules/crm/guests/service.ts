import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { GuestCreateRequest, GuestQuery, GuestSummary, ListPage } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty, ScopeDeniedError } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { forbidden } from '../../sys/settings/validation.js';
import { guestSelect, project } from './projection.js';

const staff = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'];

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
        afterJson: summary,
        reason: null,
      });
      return { summary, created: true };
    });
  }
}
