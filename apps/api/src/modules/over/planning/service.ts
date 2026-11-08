/**
 * `POST /overbooking-cases/{caseId}/relocation-plan` và `POST /overbooking-cases/{caseId}/resolve`
 * (HB-125; api.md §3.10, BR-OVER-04/06/11/12/16, F6-D07).
 *
 * Planner thuần của HB-122 quyết thứ tự (`rankRelocations`); tệp này chỉ dựng dữ kiện từ CSDL và
 * ghi kết quả đóng ca trong transaction của lệnh. Plan **không** đổi assignment (AC2).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@pinehill/domain';
import { rankRelocations } from '@pinehill/domain/overbooking';
import type {
  KeepScoreBookingStatus,
  LoyaltyTier,
  RelocationChannelCode,
} from '@pinehill/domain/overbooking';
import {
  overbookingResolveResponseSchema,
  overbookingResolveRequestSchema,
  relocationPlanRequestSchema,
  relocationPlanSchema,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import {
  arrivalMs,
  businessDate,
  businessConflict,
  invalid,
  maskedName,
  money,
  nightsBetween,
  notFound,
  parse,
  requireProperties,
  resolveDeadline,
  type Tx,
} from '../support.js';

interface CaseRow {
  id: string;
  property_id: string;
  date: Date;
  room_type_id: string;
  shortage_count: number;
  status: string;
  detected_at: Date;
  escalated_at: Date | null;
  delay_reason: string | null;
}

interface CandidateRow {
  booking_id: string;
  booking_room_id: string;
  seq: bigint;
  status: string;
  channel_code: string;
  guest_name: string;
  loyalty_tier: string;
  paid_amount: bigint;
  total_amount: bigint;
  deposit_amount: bigint;
  created_at: Date;
  check_in: Date;
  check_out: Date;
  adults: number;
  children: number;
}

const CHANNEL_CODES: Readonly<Record<string, RelocationChannelCode>> = {
  WEB: 'WEB',
  PHONE: 'PHONE',
  WALKIN: 'WALKIN',
  OTA_BOOKING: 'OTA_BOOKING',
  OTA_AGODA: 'OTA_AGODA',
  OTA_AIRBNB: 'OTA_AIRBNB',
  AGENCY: 'AGENCY',
};
const BOOKING_STATUSES: Readonly<Record<string, KeepScoreBookingStatus>> = {
  DRAFT: 'DRAFT',
  HELD: 'HELD',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  CHECKED_OUT: 'CHECKED_OUT',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  EXPIRED: 'EXPIRED',
};
const LOYALTY_TIERS: Readonly<Record<string, LoyaltyTier>> = {
  PLATINUM: 'PLATINUM',
  GOLD: 'GOLD',
  SILVER: 'SILVER',
  MEMBER: 'MEMBER',
  GUEST: 'GUEST',
};

@Injectable()
export class OverbookingPlanningService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  async plan(tx: Tx, actor: AuthorizedActor, caseId: string, body: unknown) {
    parse(relocationPlanRequestSchema, body);
    const found = await tx.$queryRaw<CaseRow[]>`
      SELECT id, property_id, date, room_type_id, shortage_count, status, detected_at,
             escalated_at, delay_reason
        FROM overbooking_cases WHERE id=${caseId}::uuid`;
    const row = found[0];
    if (row === undefined) throw notFound('Không tìm thấy ca quá tải.');
    requireProperties(actor, [row.property_id]);
    const date = businessDate(row.date);
    const roomType = await tx.$queryRaw<
      { base_price: bigint; capacity_adults: number }[]
    >`SELECT base_price, capacity_adults FROM room_types WHERE id=${row.room_type_id}::uuid`;
    const candidates = await this.candidates(tx, row, date);
    const ranked = this.rank(candidates);
    const ladder = await this.ladder(tx, row, date, roomType[0]?.base_price ?? 0n, ranked.length);
    const deadline = resolveDeadline(date);
    const now = this.clock.now();
    return relocationPlanSchema.parse({
      caseId: row.id,
      propertyId: row.property_id,
      date,
      roomTypeId: row.room_type_id,
      shortageCount: row.shortage_count,
      status: 'PROPOSED',
      resolveDeadline: deadline.toISOString(),
      overdue: now.getTime() > deadline.getTime(),
      ladder,
      candidates: ranked,
      assignmentsChanged: false,
      generatedAt: now.toISOString(),
    });
  }

  private async candidates(tx: Tx, overbooking: CaseRow, date: string): Promise<CandidateRow[]> {
    return tx.$queryRaw<CandidateRow[]>`
      SELECT b.id AS booking_id,
             (SELECT br.id FROM booking_rooms br WHERE br.booking_id=b.id ORDER BY br.id LIMIT 1)
               AS booking_room_id,
             b.seq, b.status, c.code AS channel_code, g.full_name AS guest_name,
             g.loyalty_tier, b.paid_amount, b.total_amount, b.deposit_amount, b.created_at,
             b.check_in, b.check_out, b.adults, b.children
        FROM bookings b
        JOIN guests g ON g.id=b.guest_id
        JOIN channels c ON c.id=b.channel_id
       WHERE b.property_id=${overbooking.property_id}::uuid
         AND b.room_type_id=${overbooking.room_type_id}::uuid
         AND b.status IN ('CONFIRMED','CHECKED_IN','HELD','PENDING_PAYMENT')
         AND b.check_in <= ${date}::date AND b.check_out > ${date}::date
       ORDER BY b.seq`;
  }

  private rank(candidates: readonly CandidateRow[]) {
    const now = this.clock.now().getTime();
    const byBooking = new Map(candidates.map((row) => [row.booking_id, row]));
    const input = candidates.map((row) => ({
      bookingId: row.booking_id,
      channelCode: CHANNEL_CODES[row.channel_code] ?? 'WEB',
      seq: row.seq,
      createdAtEpochMs: row.created_at.getTime(),
      loyaltyTier: LOYALTY_TIERS[row.loyalty_tier] ?? 'GUEST',
      paidAmountVnd: money(row.paid_amount),
      totalAmountVnd: money(row.total_amount),
      depositAmountVnd: money(row.deposit_amount),
      nights: nightsBetween(businessDate(row.check_in), businessDate(row.check_out)),
      staysLast12Months: 0,
      status: BOOKING_STATUSES[row.status] ?? 'CONFIRMED',
      arrivalAtEpochMs: arrivalMs(businessDate(row.check_in)),
      nowEpochMs: now,
    }));
    if (input.length === 0) return [];
    const ranked = rankRelocations(input);
    if (!ranked.ok) throw invalid('Không xếp hạng được ứng viên điều chuyển.');
    return ranked.value.map((rank, index) => {
      const row = byBooking.get(rank.bookingId)!;
      const checkIn = businessDate(row.check_in);
      const checkOut = businessDate(row.check_out);
      return {
        rank: index + 1,
        bookingId: row.booking_id,
        bookingRoomId: row.booking_room_id,
        bookingSeq: String(row.seq),
        guestNameMasked: maskedName(row.guest_name),
        channelCode: CHANNEL_CODES[row.channel_code] ?? 'WEB',
        status: row.status,
        checkIn,
        checkOut,
        nights: nightsBetween(checkIn, checkOut),
        adults: row.adults,
        children: row.children,
        keepScore: {
          total: rank.keepScore,
          loyaltyTier: rank.components.loyaltyPoints,
          payment: rank.components.paymentPoints,
          nights: rank.components.nightPoints,
          returningGuest: rank.components.repeatGuestPoints,
          arrived: rank.components.arrivalPoints,
        },
        priorityGroup: rank.priorityGroup,
        createdAt: row.created_at.toISOString(),
        paidAmount: money(row.paid_amount),
        depositAmount: money(row.deposit_amount),
        totalAmount: money(row.total_amount),
      };
    });
  }

  private async ladder(
    tx: Tx,
    overbooking: CaseRow,
    date: string,
    basePrice: bigint,
    candidateCount: number,
  ) {
    const sameType = await tx.$queryRaw<
      { total: number }[]
    >`SELECT count(*)::int AS total FROM rooms r
        WHERE r.property_id=${overbooking.property_id}::uuid
          AND r.room_type_id=${overbooking.room_type_id}::uuid AND r.status='ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id=r.id
                AND ra.released_at IS NULL
                AND ra.valid_range && daterange(${date}::date, ${date}::date + 1, '[)'))`;
    const upgrade = await tx.$queryRaw<
      { total: number }[]
    >`SELECT count(*)::int AS total FROM rooms r
        JOIN room_types rt ON rt.id=r.room_type_id
        WHERE r.property_id=${overbooking.property_id}::uuid
          AND r.room_type_id <> ${overbooking.room_type_id}::uuid
          AND r.status='ACTIVE' AND rt.status='ACTIVE' AND rt.base_price >= ${basePrice}
          AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id=r.id
                AND ra.released_at IS NULL
                AND ra.valid_range && daterange(${date}::date, ${date}::date + 1, '[)'))`;
    const sameCount = sameType[0]?.total ?? 0;
    const upgradeCount = upgrade[0]?.total ?? 0;
    return [
      {
        step: 1,
        moveType: 'SAME_TYPE_SAME_PROPERTY',
        feasible: sameCount > 0,
        candidateCount: sameCount,
        ...(sameCount > 0 ? {} : { note: 'Không còn phòng cùng loại trống cho đêm thiếu.' }),
      },
      {
        step: 2,
        moveType: 'UPGRADE_SAME_PROPERTY',
        feasible: upgradeCount > 0,
        candidateCount: upgradeCount,
        ...(upgradeCount > 0
          ? {}
          : { note: 'Không còn phòng hạng cao hơn trống trong cùng cơ sở.' }),
      },
      {
        step: 3,
        moveType: 'SAME_TYPE_CROSS_PROPERTY',
        feasible: false,
        candidateCount: 0,
        note: 'Bậc 3 tạm khoá: các cơ sở cách nhau 160–300 km; cần lead chốt địa lý (BR-OVER-06).',
      },
      {
        step: 4,
        moveType: 'WALK_OUT',
        feasible: true,
        candidateCount,
        ...(candidateCount > 0 ? {} : { note: 'Không có ứng viên để điều chuyển; chỉ walk-out.' }),
      },
    ];
  }

  /** AC10: đóng ca chỉ khi thiếu phòng thực tế = 0 — đo bằng đơn vị còn thiếu chỗ. */
  async resolve(tx: Tx, actor: AuthorizedActor, caseId: string, body: unknown) {
    const input = parse(overbookingResolveRequestSchema, body);
    const found = await tx.$queryRaw<CaseRow[]>`
      SELECT id, property_id, date, room_type_id, shortage_count, status, detected_at,
             escalated_at, delay_reason
        FROM overbooking_cases WHERE id=${caseId}::uuid FOR UPDATE`;
    const row = found[0];
    if (row === undefined) throw notFound('Không tìm thấy ca quá tải.');
    requireProperties(actor, [row.property_id]);
    if (row.status === 'RESOLVED')
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Ca quá tải đã được đóng.');
    const shortage = await tx.$queryRaw<{ unassigned: number }[]>`SELECT count(*)::int AS unassigned
        FROM booking_rooms br JOIN bookings b ON b.id=br.booking_id
       WHERE b.property_id=${row.property_id}::uuid
         AND b.room_type_id=${row.room_type_id}::uuid
         AND b.status IN ('CONFIRMED','CHECKED_IN')
         AND NOT EXISTS (SELECT 1 FROM room_assignments ra
                          WHERE ra.booking_room_id=br.id AND ra.released_at IS NULL)`;
    if ((shortage[0]?.unassigned ?? 0) > 0)
      throw businessConflict(
        'E_OVER_LIMIT_EXCEEDED',
        'Ca còn đơn vị chưa có phòng; xử lý hết thiếu phòng thực tế trước khi đóng ca.',
      );
    const now = this.clock.now();
    await tx.$executeRaw`
      UPDATE overbooking_cases
         SET status='RESOLVED', resolved_at=${now}::timestamptz, resolved_by=${actor.id}::uuid,
             resolution_source='USER', updated_at=${now}::timestamptz
       WHERE id=${row.id}::uuid`;
    await this.audit.record(tx, {
      actor,
      action: 'OVERBOOKING_RESOLVED',
      entityType: 'OverbookingCase',
      entityId: row.id,
      beforeJson: {
        propertyId: row.property_id,
        status: row.status,
        shortageCount: row.shortage_count,
        detectedAt: row.detected_at.toISOString(),
        escalatedAt: row.escalated_at?.toISOString() ?? null,
      },
      afterJson: {
        propertyId: row.property_id,
        status: 'RESOLVED',
        resolutionSource: 'USER',
        resolvedBy: actor.id,
        actualShortage: 0,
        note: input.resolutionNote,
      },
      reason: input.resolutionNote,
    });
    const audit = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM audit_logs WHERE entity_type='OverbookingCase' AND entity_id=${row.id}::uuid
        AND action='OVERBOOKING_RESOLVED' ORDER BY chain_seq DESC LIMIT 1`;
    if (audit[0] === undefined) throw invalid('Không ghi được nhật ký đóng ca.');
    return overbookingResolveResponseSchema.parse({
      caseId: row.id,
      status: 'RESOLVED',
      resolutionSource: 'USER',
      resolvedBy: actor.id,
      resolvedAt: now.toISOString(),
      resolutionNote: input.resolutionNote,
      auditLogId: audit[0].id,
    });
  }
}
