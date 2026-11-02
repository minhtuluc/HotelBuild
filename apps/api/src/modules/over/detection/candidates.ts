/**
 * Ứng viên điều chuyển và thang bốn bậc cho đường đọc ca quá tải (HB-126; HB-120 AC5/AC12).
 *
 * Thứ tự BR-OVER-11/12: nhóm `WEAK` (HELD, WALKIN chưa trả tiền) luôn trước; trong nhóm
 * `keepScore` ↑ → `createdAt` ↓ → `Booking.seq` ↑. `affectedBookingIds` là `shortageCount` ứng viên
 * đầu tiên theo đúng thứ tự này. Thang 1→2→4: bậc 3 khác cơ sở luôn không khả dụng vì ba cơ sở cách
 * nhau 160–300 km (> 15 km) và phải nêu lý do (BR-OVER-06).
 */
import type { Prisma } from '@prisma/client';
import { keepScore } from '@pinehill/domain/overbooking';
import type {
  KeepScoreBookingStatus,
  KeepScoreFactors,
  LoyaltyTier,
  RelocationChannelCode,
} from '@pinehill/domain/overbooking';
import { demandOn } from './facts.js';
import type { PropertyFacts, TypeFacts } from './facts.js';
import { DAY_MS, zonedInstant } from './support.js';

const LOYALTY: Readonly<Record<string, LoyaltyTier>> = {
  GUEST: 'GUEST',
  MEMBER: 'MEMBER',
  SILVER: 'SILVER',
  GOLD: 'GOLD',
  PLATINUM: 'PLATINUM',
};
const CHANNELS: Readonly<Record<string, RelocationChannelCode>> = {
  WEB: 'WEB',
  PHONE: 'PHONE',
  WALKIN: 'WALKIN',
  OTA_BOOKING: 'OTA_BOOKING',
  OTA_AGODA: 'OTA_AGODA',
  OTA_AIRBNB: 'OTA_AIRBNB',
  AGENCY: 'AGENCY',
};
const KEEP_STATUS: Readonly<Record<string, KeepScoreBookingStatus>> = {
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
const PRIORITY_GROUP_RANK = { WEAK: 0, STRONG: 1 } as const;
const CROSS_PROPERTY_NOTE = 'bậc 3 không khả dụng: ba cơ sở cách nhau 160–300 km (> 15 km)';

export interface BalancedCandidate {
  readonly bookingId: string;
  readonly bookingRoomId: string;
  readonly priorityGroup: 'WEAK' | 'STRONG';
  readonly keepScore: number;
  readonly keepScoreBreakdown: {
    readonly loyalty: number;
    readonly payment: number;
    readonly nights: number;
    readonly repeat: number;
    readonly arrived: number;
  };
  readonly createdAt: string;
  readonly bookingSeq: string;
}

export interface LadderRung {
  readonly moveType:
    'SAME_TYPE_SAME_PROPERTY' | 'UPGRADE_SAME_PROPERTY' | 'SAME_TYPE_CROSS_PROPERTY' | 'WALK_OUT';
  readonly feasible: boolean;
  readonly candidateCount: number;
  readonly note?: string;
}

export interface CaseCandidates {
  readonly candidates: readonly BalancedCandidate[];
  readonly affectedBookingIds: readonly string[];
  readonly ladderPreview: readonly LadderRung[];
}

function positive(value: number | undefined): number {
  return value !== undefined && value > 0 ? value : 0;
}

function stayNights(checkIn: Date, checkOut: Date): number {
  return Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS));
}

export interface CandidateBookingRow {
  readonly id: string;
  readonly seq: bigint;
  readonly status: string;
  readonly created_at: Date;
  readonly paid_amount: bigint;
  readonly total_amount: bigint;
  readonly deposit_amount: bigint;
  readonly check_in: Date;
  readonly check_out: Date;
  readonly channels: { readonly code: string };
  readonly guests: { readonly loyalty_tier: string; readonly total_stays: number };
}

export interface CandidateRow {
  readonly id: string;
  readonly bookings: CandidateBookingRow;
}

function candidateOf(
  row: CandidateRow,
  property: PropertyFacts,
  now: Date,
): BalancedCandidate | null {
  const booking = row.bookings;
  const channelCode = CHANNELS[booking.channels.code];
  const status = KEEP_STATUS[booking.status];
  if (channelCode === undefined || status === undefined) return null;
  const checkIn = booking.check_in.toISOString().slice(0, 10);
  const factors: KeepScoreFactors = {
    loyaltyTier: LOYALTY[booking.guests.loyalty_tier] ?? 'GUEST',
    paidAmountVnd: Number(booking.paid_amount),
    totalAmountVnd: Number(booking.total_amount),
    depositAmountVnd: Number(booking.deposit_amount),
    nights: stayNights(booking.check_in, booking.check_out),
    staysLast12Months: booking.guests.total_stays,
    status,
    arrivalAtEpochMs: zonedInstant(
      checkIn,
      property.meta.checkInTime,
      property.meta.timezone,
    ).getTime(),
    nowEpochMs: now.getTime(),
  };
  const scored = keepScore(factors);
  if (!scored.ok) return null;
  const group =
    status === 'HELD' || (channelCode === 'WALKIN' && factors.paidAmountVnd === 0)
      ? 'WEAK'
      : 'STRONG';
  return {
    bookingId: booking.id,
    bookingRoomId: row.id,
    priorityGroup: group,
    keepScore: scored.value.total,
    keepScoreBreakdown: {
      loyalty: scored.value.loyaltyPoints,
      payment: scored.value.paymentPoints,
      nights: scored.value.nightPoints,
      repeat: scored.value.repeatGuestPoints,
      arrived: scored.value.arrivalPoints,
    },
    createdAt: booking.created_at.toISOString(),
    bookingSeq: String(booking.seq),
  };
}

function loadRows(db: Prisma.TransactionClient, ids: readonly string[]): Promise<CandidateRow[]> {
  return db.booking_rooms.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      bookings: {
        select: {
          id: true,
          seq: true,
          status: true,
          created_at: true,
          paid_amount: true,
          total_amount: true,
          deposit_amount: true,
          check_in: true,
          check_out: true,
          channels: { select: { code: true } },
          guests: { select: { loyalty_tier: true, total_stays: true } },
        },
      },
    },
  });
}

function compareCandidates(left: BalancedCandidate, right: BalancedCandidate): number {
  const group = PRIORITY_GROUP_RANK[left.priorityGroup] - PRIORITY_GROUP_RANK[right.priorityGroup];
  if (group !== 0) return group;
  if (left.keepScore !== right.keepScore) return left.keepScore - right.keepScore;
  const created = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (created !== 0) return created;
  const leftSeq = BigInt(left.bookingSeq);
  const rightSeq = BigInt(right.bookingSeq);
  if (leftSeq !== rightSeq) return leftSeq < rightSeq ? -1 : 1;
  return left.bookingRoomId.localeCompare(right.bookingRoomId);
}

/** Ứng viên của đúng ca: nhu cầu hiệu lực trên `(property, date, roomType)`, đã xếp hạng. */
export async function candidatesForCase(
  db: Prisma.TransactionClient,
  property: PropertyFacts,
  type: TypeFacts,
  date: string,
  shortage: number,
  now: Date,
): Promise<CaseCandidates> {
  const demand = demandOn(
    type.facts,
    date,
    { propertyId: property.meta.id, roomTypeId: type.id },
    now,
  );
  const rows =
    demand.length === 0
      ? []
      : await loadRows(
          db,
          demand.map((item) => item.bookingRoomId),
        );
  const candidates = rows
    .map((row) => candidateOf(row, property, now))
    .filter((item): item is BalancedCandidate => item !== null)
    .sort(compareCandidates);
  return {
    candidates,
    affectedBookingIds: candidates.slice(0, shortage).map((item) => item.bookingId),
    ladderPreview: ladderFor(property, type, date, shortage),
  };
}

/** Thang 4 bậc theo BR-OVER-06; bậc 3 luôn `false` kèm lý do khoảng cách. */
export function ladderFor(
  property: PropertyFacts,
  type: TypeFacts,
  date: string,
  shortage: number,
): readonly LadderRung[] {
  const sameType = positive(type.pools.get(date));
  const upgrades = property.types
    .filter((item) => item.id !== type.id && item.basePrice >= type.basePrice)
    .reduce((total, item) => total + positive(item.pools.get(date)), 0);
  return [
    {
      moveType: 'SAME_TYPE_SAME_PROPERTY',
      feasible: sameType > 0,
      candidateCount: sameType,
    },
    {
      moveType: 'UPGRADE_SAME_PROPERTY',
      feasible: upgrades > 0,
      candidateCount: upgrades,
    },
    {
      moveType: 'SAME_TYPE_CROSS_PROPERTY',
      feasible: false,
      candidateCount: 0,
      note: CROSS_PROPERTY_NOTE,
    },
    {
      moveType: 'WALK_OUT',
      feasible: true,
      candidateCount: Math.max(0, shortage),
    },
  ];
}
