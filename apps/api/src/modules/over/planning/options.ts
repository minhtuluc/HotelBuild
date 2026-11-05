/**
 * `GET /bookings/{bookingId}/relocation-options` (HB-120 AC12/AC14, HB-125 AC14).
 *
 * Chỉ trả phương án cho **chính** booking đang tra: không bảng xếp hạng, không `keepScore`, không PII
 * của booking khác. Tồn phòng đọc tại thời điểm gọi, **không** giữ chỗ; mọi ý định ghi đi qua
 * `POST /room-moves`/`POST /room-merges`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { bookingRelocationOptionsSchema, relocationOptionsQuerySchema } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import {
  businessDate,
  invalid,
  money,
  notFound,
  parse,
  requireProperties,
  writeIntentOf,
} from '../support.js';

interface BookingRow {
  id: string;
  property_id: string;
  room_type_id: string;
  check_in: Date;
  check_out: Date;
  adults: number;
  version: bigint;
}

interface CaseRow {
  id: string;
  date: Date;
  property_id: string;
}

interface RoomRow {
  id: string;
  property_id: string;
  room_type_id: string;
}

interface TargetFields {
  targetPropertyId: string | null;
  targetRoomId: string | null;
  targetRoomTypeId: string | null;
}

type RoomMoveKind =
  'SAME_TYPE_SAME_PROPERTY' | 'UPGRADE_SAME_PROPERTY' | 'SAME_TYPE_CROSS_PROPERTY';

function targetFields(room: RoomRow | null): TargetFields {
  if (room === null) return { targetPropertyId: null, targetRoomId: null, targetRoomTypeId: null };
  return {
    targetPropertyId: room.property_id,
    targetRoomId: room.id,
    targetRoomTypeId: room.room_type_id,
  };
}

@Injectable()
export class RelocationOptionsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async read(actor: AuthorizedActor, bookingId: string, query: unknown) {
    const input = parse(relocationOptionsQuerySchema, query);
    const rows = await this.db.$queryRaw<BookingRow[]>`
      SELECT id, property_id, room_type_id, check_in, check_out, adults, version
        FROM bookings WHERE id=${bookingId}::uuid`;
    const booking = rows[0];
    if (booking === undefined) throw notFound('Không tìm thấy booking.');
    requireProperties(actor, [booking.property_id]);
    const checkIn = businessDate(booking.check_in);
    const checkOut = businessDate(booking.check_out);
    if (checkIn >= checkOut) throw invalid('Kỳ lưu trú của booking không hợp lệ.');
    const overbookingCase = await this.caseFor(booking, input.overbookingCaseId);
    const options = await this.options(actor, booking, checkIn, checkOut, overbookingCase);
    const writeIntent = await writeIntentOf(
      this.db,
      actor,
      input.idempotencyKey,
      'RELOCATION_PLAN',
      null,
      null,
    );
    return {
      etag: `"${booking.version}"`,
      body: bookingRelocationOptionsSchema.parse({
        bookingId: booking.id,
        overbookingCaseId: overbookingCase?.id ?? null,
        date: overbookingCase === null ? null : businessDate(overbookingCase.date),
        options,
        generatedAt: this.clock.now().toISOString(),
        writeIntent,
      }),
    };
  }

  private async caseFor(booking: BookingRow, caseId: string | undefined): Promise<CaseRow | null> {
    const checkIn = businessDate(booking.check_in);
    const checkOut = businessDate(booking.check_out);
    const rows =
      caseId === undefined
        ? await this.db.$queryRaw<CaseRow[]>`
            SELECT id, date, property_id FROM overbooking_cases
             WHERE property_id=${booking.property_id}::uuid
               AND room_type_id=${booking.room_type_id}::uuid
               AND status IN ('OPEN','PROPOSED','ESCALATED')
               AND date >= ${checkIn}::date AND date < ${checkOut}::date
             ORDER BY date LIMIT 1`
        : await this.db.$queryRaw<CaseRow[]>`
            SELECT id, date, property_id FROM overbooking_cases WHERE id=${caseId}::uuid`;
    const row = rows[0];
    if (row === undefined) {
      if (caseId !== undefined) throw notFound('Không tìm thấy ca quá tải.');
      return null;
    }
    return row;
  }

  private async options(
    actor: AuthorizedActor,
    booking: BookingRow,
    checkIn: string,
    checkOut: string,
    overbookingCase: CaseRow | null,
  ) {
    requireProperties(actor, [overbookingCase?.property_id]);
    const scope = actor.isOwner() ? null : [...actor.propertyScope];
    const sameType = await this.freeRoom(
      [booking.property_id],
      booking.room_type_id,
      checkIn,
      checkOut,
    );
    const upgrade = await this.upgradeRoom(booking, checkIn, checkOut);
    const cross = await this.crossRoom(
      scope,
      booking.property_id,
      booking.room_type_id,
      booking.adults,
      checkIn,
      checkOut,
    );
    const firstNight = await this.firstNight(booking.id);
    return [
      this.roomOption(
        'SAME_TYPE_SAME_PROPERTY',
        sameType,
        'Không còn phòng cùng loại trống cho toàn kỳ lưu trú.',
      ),
      this.roomOption(
        'UPGRADE_SAME_PROPERTY',
        upgrade,
        'Không còn phòng hạng cao hơn đủ sức chứa trong cùng cơ sở.',
      ),
      this.roomOption(
        'SAME_TYPE_CROSS_PROPERTY',
        cross,
        'Không có cơ sở khác cùng hạng phòng trong phạm vi được phép.',
      ),
      this.walkOutOption(overbookingCase, firstNight),
    ];
  }

  private roomOption(moveType: RoomMoveKind, room: RoomRow | null, missingNote: string) {
    return {
      moveType,
      feasible: room !== null,
      ...targetFields(room),
      priceLocked: true as const,
      compensationAmount: 0,
      transportCost: 0,
      ...(room === null ? { note: missingNote } : {}),
    };
  }

  private walkOutOption(overbookingCase: CaseRow | null, compensationAmount: number) {
    return {
      moveType: 'WALK_OUT' as const,
      feasible: true,
      targetPropertyId: null,
      targetRoomId: null,
      targetRoomTypeId: null,
      priceLocked: true as const,
      compensationAmount,
      transportCost: 0,
      ...(overbookingCase === null ? {} : { note: 'Walk-out theo ca quá tải đang mở.' }),
    };
  }

  private freeRoom(
    properties: readonly string[],
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
  ): Promise<RoomRow | null> {
    return this.db.$queryRaw<RoomRow[]>`
        SELECT r.id, r.property_id, r.room_type_id FROM rooms r
         WHERE r.property_id = ANY(${[...properties]}::uuid[])
           AND r.room_type_id=${roomTypeId}::uuid AND r.status='ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id=r.id
                 AND ra.released_at IS NULL
                 AND ra.valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
           AND NOT EXISTS (SELECT 1 FROM room_blocks rb WHERE rb.room_id=r.id
                 AND daterange(rb.start_date, rb.end_date, '[)')
                     && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
         ORDER BY r.property_id, r.code LIMIT 1`.then((rows) => rows[0] ?? null);
  }

  private upgradeRoom(
    booking: BookingRow,
    checkIn: string,
    checkOut: string,
  ): Promise<RoomRow | null> {
    return this.db.$queryRaw<RoomRow[]>`
        SELECT r.id, r.property_id, r.room_type_id FROM rooms r
          JOIN room_types rt ON rt.id=r.room_type_id
          JOIN room_types base ON base.id=${booking.room_type_id}::uuid
         WHERE r.property_id=${booking.property_id}::uuid
           AND r.room_type_id <> ${booking.room_type_id}::uuid
           AND r.status='ACTIVE' AND rt.status='ACTIVE'
           AND rt.base_price >= base.base_price AND rt.capacity_adults >= ${booking.adults}
           AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id=r.id
                 AND ra.released_at IS NULL
                 AND ra.valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
           AND NOT EXISTS (SELECT 1 FROM room_blocks rb WHERE rb.room_id=r.id
                 AND daterange(rb.start_date, rb.end_date, '[)')
                     && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
         ORDER BY rt.base_price, r.code LIMIT 1`.then((rows) => rows[0] ?? null);
  }

  private crossRoom(
    scope: readonly string[] | null,
    propertyId: string,
    roomTypeId: string,
    adults: number,
    checkIn: string,
    checkOut: string,
  ): Promise<RoomRow | null> {
    const free = (rows: RoomRow[]) => rows[0] ?? null;
    if (scope === null)
      return this.db.$queryRaw<RoomRow[]>`
          SELECT r.id, r.property_id, r.room_type_id FROM rooms r
            JOIN room_types rt ON rt.id=r.room_type_id
            JOIN room_types base ON base.id=${roomTypeId}::uuid
           WHERE r.property_id <> ${propertyId}::uuid AND rt.code=base.code
             AND r.status='ACTIVE' AND rt.status='ACTIVE' AND rt.capacity_adults >= ${adults}
             AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id=r.id
                   AND ra.released_at IS NULL
                   AND ra.valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
             AND NOT EXISTS (SELECT 1 FROM room_blocks rb WHERE rb.room_id=r.id
                   AND daterange(rb.start_date, rb.end_date, '[)')
                       && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
           ORDER BY r.property_id, r.code LIMIT 1`.then(free);
    return this.db.$queryRaw<RoomRow[]>`
        SELECT r.id, r.property_id, r.room_type_id FROM rooms r
          JOIN room_types rt ON rt.id=r.room_type_id
          JOIN room_types base ON base.id=${roomTypeId}::uuid
         WHERE r.property_id = ANY(${[...scope]}::uuid[]) AND r.property_id <> ${propertyId}::uuid
           AND rt.code=base.code AND r.status='ACTIVE' AND rt.status='ACTIVE'
           AND rt.capacity_adults >= ${adults}
           AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id=r.id
                 AND ra.released_at IS NULL
                 AND ra.valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
           AND NOT EXISTS (SELECT 1 FROM room_blocks rb WHERE rb.room_id=r.id
                 AND daterange(rb.start_date, rb.end_date, '[)')
                     && daterange(${checkIn}::date, ${checkOut}::date, '[)'))
         ORDER BY r.property_id, r.code LIMIT 1`.then(free);
  }

  private async firstNight(bookingId: string): Promise<number> {
    const rows = await this.db.$queryRaw<{ amount: bigint }[]>`SELECT amount FROM booking_charges
        WHERE booking_id=${bookingId}::uuid AND kind='ROOM'
        ORDER BY stay_date NULLS LAST, id LIMIT 1`;
    const amount = rows[0]?.amount;
    return amount === undefined ? 0 : money(amount);
  }
}
