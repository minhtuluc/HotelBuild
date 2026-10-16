/**
 * UC-RATE-01 — lịch giá theo loại phòng (SCR-26).
 *
 * Đọc: mọi ngày trong khoảng được tính **một lần** bằng `quotePrice` của engine HB-052 trên dữ kiện
 * nạp từ CSDL, nên `source`, mùa thắng, hệ số và giá từng đêm luôn khớp nhau và khớp báo giá sau này.
 *
 * Ghi: dòng `OVERRIDE` (priority 100) thay thế dòng ghi đè **cùng phạm vi** `(loại phòng, ngày, kênh)`,
 * vì BR-RATE-02 chọn dòng cũ hơn khi cùng nguồn/kênh — thêm dòng mới mà giữ dòng cũ thì thay đổi sẽ
 * không có hiệu lực. Audit + `RateChanged` nằm trong cùng transaction với lệnh ghi (BR-SYS-01).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
import { quotePrice } from '@pinehill/domain/pricing';
import type { RateCalendar } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { loadPricingFacts } from './facts.js';
import {
  calendarEntry,
  calendarResponse,
  calendarWarnings,
  overrideSnapshot,
} from './projection.js';
import { largeChange, priceIssues } from './validation.js';
import type { CalendarQuery, OverrideInput, RateSource } from './validation.js';
import {
  configurationAll,
  missing,
  nextDay,
  owner,
  reader,
  safeDatabaseError,
  sqlDate,
} from './support.js';

/** `ck_rate_calendars_priority`: dòng `OVERRIDE` luôn là ưu tiên cao nhất (BR-RATE-02). */
const OVERRIDE_PRIORITY = 100;

type RoomTypeRow = Prisma.room_typesGetPayload<{ include: { properties: true } }>;

export class RateCalendarService {
  constructor(
    readonly db: PrismaClient,
    readonly ids: IdGenerator,
    readonly audit: AuditWriter,
  ) {}

  async get(actor: AuthorizedActor, query: CalendarQuery): Promise<RateCalendar> {
    reader(actor);
    try {
      return await this.db.$transaction(
        async (tx) =>
          this.response(
            tx,
            await this.scopedRoomType(tx, actor, query.roomTypeId),
            query,
            query.source,
          ),
        { isolationLevel: 'RepeatableRead' },
      );
    } catch (error) {
      return safeDatabaseError(error);
    }
  }

  async override(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    input: OverrideInput,
  ): Promise<RateCalendar> {
    owner(actor);
    try {
      // Khoá loại phòng để hai lệnh ghi đè chồng ngày không xen kẽ bước xoá–thêm.
      const type = await this.lockedRoomType(tx, actor, input.roomTypeId);
      const issues = priceIssues(input.items, {
        minPrice: Number(type.min_price),
        maxPrice: Number(type.max_price),
      });
      if (issues.length > 0)
        configurationAll(issues, 'Giá nằm ngoài sàn–trần của loại phòng (BR-RATE-04).');

      const dates = input.items.map((item) => item.date).sort(),
        range = { from: dates[0]!, to: dates.at(-1)! };
      const before = await this.response(tx, type, range, undefined, input.channelCode);
      const currentByDate = new Map(
        before.entries.map((entry) => [entry.date, entry.nightlyPrice]),
      );
      const unconfirmed = input.items.flatMap((item, index) => {
        const current = currentByDate.get(item.date);
        if (current === undefined) throw new Error('RATE_CALENDAR_ENTRY_MISSING');
        return largeChange(current, item.price) && !input.confirmOwnerOverride
          ? [{ field: `items[${index}].price`, issue: 'OWNER_CONFIRMATION_REQUIRED' }]
          : [];
      });
      if (unconfirmed.length > 0)
        configurationAll(
          unconfirmed,
          'Thay đổi giá vượt ±20% so với giá hiện hành cần OWNER xác nhận lại (BR-RBAC-04).',
        );

      const scope = {
        room_type_id: type.id,
        source: 'OVERRIDE',
        channel_code: input.channelCode ?? null,
      };
      const previous = await tx.rate_calendars.findMany({
        where: { ...scope, date: { gte: sqlDate(range.from), lte: sqlDate(range.to) } },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      });
      await tx.rate_calendars.deleteMany({
        where: { ...scope, date: { in: input.items.map((item) => sqlDate(item.date)) } },
      });
      const created = [];
      for (const item of input.items)
        created.push(
          await tx.rate_calendars.create({
            data: {
              room_type_id: type.id,
              property_id: type.property_id,
              date: sqlDate(item.date),
              price: BigInt(item.price),
              source: 'OVERRIDE',
              priority: OVERRIDE_PRIORITY,
              channel_code: input.channelCode ?? null,
              reason: input.reason,
              created_by: actor.id,
            },
          }),
        );

      const after = await this.response(tx, type, range, undefined, input.channelCode);
      await this.audit.record(tx, {
        actor,
        action: 'RATE_CALENDAR_OVERRIDDEN',
        entityType: 'RateCalendar',
        entityId: type.id,
        beforeJson: overrideSnapshot(type.id, input.channelCode ?? null, previous),
        afterJson: overrideSnapshot(type.id, input.channelCode ?? null, created),
        reason: input.reason,
      });
      await tx.outbox_events.create({
        data: {
          id: this.ids.generate(),
          event_type: 'RateChanged',
          aggregate_type: 'RateCalendar',
          aggregate_id: type.id,
          payload_json: {
            schemaVersion: 1,
            entityType: 'RateCalendar',
            entityId: type.id,
            propertyId: type.property_id,
            channelCode: input.channelCode ?? null,
            dates: dates,
          },
        },
      });
      return after;
    } catch (error) {
      return safeDatabaseError(error);
    }
  }

  /** Loại phòng + kiểm phạm vi cơ sở; MANAGER chỉ đọc/ghi được cơ sở trong `propertyScope` (BR-RBAC-03). */
  private async scopedRoomType(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    roomTypeId: string,
  ): Promise<RoomTypeRow> {
    const type = await tx.room_types.findUnique({
      where: { id: roomTypeId },
      include: { properties: true },
    });
    if (!type) throw missing();
    requireProperty(actor, type.property_id);
    return type;
  }

  private async lockedRoomType(
    tx: Prisma.TransactionClient,
    actor: AuthorizedActor,
    roomTypeId: string,
  ): Promise<RoomTypeRow> {
    await this.scopedRoomType(tx, actor, roomTypeId);
    await tx.$queryRaw`SELECT id FROM room_types WHERE id=${roomTypeId}::uuid FOR UPDATE`;
    return this.scopedRoomType(tx, actor, roomTypeId);
  }

  /** Một lần chạy engine cho **cả** khoảng: số ngày = số đêm, `checkOut` là mốc loại trừ. */
  private async response(
    tx: Prisma.TransactionClient,
    type: RoomTypeRow,
    range: { readonly from: string; readonly to: string },
    sourceFilter?: RateSource,
    channelCode?: string,
  ): Promise<RateCalendar> {
    const facts = await loadPricingFacts(tx, {
      propertyId: type.property_id,
      room: {
        id: type.id,
        basePrice: Number(type.base_price),
        minPrice: Number(type.min_price),
        maxPrice: Number(type.max_price),
      },
      checkIn: range.from,
      checkOut: nextDay(range.to),
      ...(channelCode === undefined ? {} : { channelCode }),
    });
    const result = quotePrice(facts.input);
    if (!result.ok) throw new Error(`RATE_CALENDAR_PRICING_FAILED:${result.error.code}`);
    const seasonNames = new Map(facts.seasons.map((season) => [season.id, season.name]));
    const entries = result.value.nights
      .map((night) =>
        calendarEntry(night, night.seasonId === null ? undefined : seasonNames.get(night.seasonId)),
      )
      .filter((entry) => sourceFilter === undefined || entry.source === sourceFilter);
    return calendarResponse({
      roomTypeId: type.id,
      from: range.from,
      to: range.to,
      entries,
      warnings: calendarWarnings(facts, range),
    });
  }
}
