/**
 * Dựng `PriceSnapshot` ORIGINAL (HB-077 AC1; BR-RATE-16, ADR-015 §3,4) từ **quote đã tiêu thụ**, kèm
 * **nghĩa vụ phòng–đêm** (`booking_charges.kind = 'ROOM'`) — hai mặt của cùng một con số đã bán:
 *
 * - `price_snapshots`: `quote_id`/`quote_fingerprint` (ràng buộc UNIQUE `quote_id` là chỗ PostgreSQL
 *   bảo đảm "một quote chỉ nhận vào một booking"), `engine_version`, `policy_snapshot_json`, và
 *   `payload_json` theo hình dạng mà HB-097 (`snapshotPayloadSchema` trong `book/cancel/context.ts`)
 *   cùng báo cáo doanh thu phòng (`rep/reports/queries.ts`) đọc lại: `ratePlan`, `policy`, `stay`,
 *   `nights[]` (`bookingRoomId`/`date`/`grossAmount`/`commissionAmount`/`nightlyPrice`) và `totals` khớp
 *   hai cột `gross_amount`/`commission_amount`;
 * - `booking_charges` ROOM: một dòng cho mỗi (đơn vị bán × đêm) với `source_key` tất định
 *   `ROOM:<bookingRoomId>:<YYYY-MM-DD>`, để sổ cái (`pay/ledger`, BR-PAY-02 với bất biến
 *   `Σ ROOM == bookings.total_amount`) và cơ sở phân bổ khi huỷ (BR-CANCEL-19) có dữ liệu thật.
 *
 * Phân bổ: tổng kỳ `quote.total` chia cho các ô (đơn vị bán × đêm) theo **trọng số** là giá đêm của
 * engine (`nights[].nightlyPrice`) bằng phương pháp cộng dồn–làm-tròn-xuống, nên `Σ ô == total` **tuyệt
 * đối** và kết quả tất định. Không tính lại giá: mọi con số lấy từ quote (BR-RATE-17).
 */
import type { Prisma } from '@prisma/client';
import type { Quote } from '@pinehill/contracts';
import type { PolicySnapshot } from './policy.js';

/** Phiên bản hình dạng payload; đổi hình dạng thì tăng số này (ADR-015 §4). */
export const PRICE_SNAPSHOT_SCHEMA_VERSION = 1;

/** Dòng `channel_property_settings` đang hiệu lực của kênh (hoa hồng theo `effective_from`). */
export interface CommissionSetting {
  readonly id: string;
  readonly commissionPercent: number;
  readonly effectiveFrom: string;
}

export interface SnapshotRatePlan {
  readonly id: string;
  readonly code: string;
  readonly minNights: number;
  readonly maxNights: number;
  readonly losDiscountEnabled: boolean;
  readonly depositPercent: number;
}

export interface SnapshotStay {
  readonly timezone: string;
  readonly checkInTime: string;
  readonly checkOutTime: string;
}

export interface SnapshotSource {
  readonly quote: Quote;
  readonly quoteId: string;
  readonly quoteFingerprint: string;
  readonly channelCode: string;
  readonly ratePlan: SnapshotRatePlan;
  readonly policy: PolicySnapshot;
  readonly stay: SnapshotStay;
  readonly settings: readonly CommissionSetting[];
  /** Số đơn vị bán của booking (`roomCount`) — mỗi đơn vị một dòng `booking_rooms` (BR-BOOK-10). */
  readonly roomCount: number;
}

export interface PlannedNight {
  readonly date: string;
  readonly grossAmount: bigint;
  readonly commissionAmount: bigint;
  readonly commissionPercent: number;
  readonly channelSettingId: string | null;
}

export interface PlannedRoom {
  readonly nights: readonly PlannedNight[];
  /** Giá phòng–đêm của **đơn vị bán này** (bình quân cả kỳ, làm tròn xuống) cho `booking_rooms`. */
  readonly pricePerNight: bigint;
}

export interface SnapshotPlan {
  readonly rooms: readonly PlannedRoom[];
  readonly grossAmount: bigint;
  readonly commissionAmount: bigint;
  /** Dòng cấu hình kênh đã dùng cho đêm đầu — cột FK `price_snapshots.channel_property_setting_id`. */
  readonly channelPropertySettingId: string | null;
}

/**
 * Chia `total` cho `weights` theo cộng dồn–làm-tròn-xuống: ô cuối nhận phần dư nên tổng **đúng bằng**
 * `total`, không thất lạc đồng nào (BR-GEN-01: VND nguyên).
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((accumulated, weight) => accumulated + weight, 0n);
  if (weights.length === 0 || sum <= 0n)
    throw new Error('Snapshot allocation requires positive weights');
  const cells: bigint[] = [];
  let cumulative = 0n;
  let assigned = 0n;
  for (const weight of weights) {
    cumulative += weight;
    const target = (total * cumulative) / sum;
    cells.push(target - assigned);
    assigned = target;
  }
  return cells;
}

/** Hoa hồng kênh của một đêm = `commission_pct` của dòng cấu hình mới nhất có `effective_from ≤ ngày`. */
function settingFor(
  settings: readonly CommissionSetting[],
  date: string,
): CommissionSetting | null {
  let current: CommissionSetting | null = null;
  for (const setting of settings)
    if (
      setting.effectiveFrom <= date &&
      (current === null || setting.effectiveFrom >= current.effectiveFrom)
    )
      current = setting;
  return current;
}

/** `numeric(5,2)` là phần trăm nguyên-hai-chữ-số; nhân chéo bằng BigInt để không sai số dấu phẩy động. */
function commissionOf(grossAmount: bigint, commissionPercent: number): bigint {
  if (commissionPercent <= 0) return 0n;
  const hundredths = BigInt(Math.round(commissionPercent * 100));
  const commission = (grossAmount * hundredths) / 10_000n;
  return commission > grossAmount ? grossAmount : commission;
}

/** Một đêm của một đơn vị bán: hoa hồng lấy theo dòng cấu hình kênh hiệu lực của ngày đó. */
function planNight(source: SnapshotSource, date: string, grossAmount: bigint): PlannedNight {
  const setting = settingFor(source.settings, date);
  const commissionPercent = setting === null ? 0 : setting.commissionPercent;
  return {
    date,
    grossAmount,
    commissionAmount: commissionOf(grossAmount, commissionPercent),
    commissionPercent,
    channelSettingId: setting === null ? null : setting.id,
  };
}

function totalsOf(rooms: readonly PlannedRoom[]): {
  readonly gross: bigint;
  readonly commission: bigint;
} {
  let gross = 0n;
  let commission = 0n;
  for (const room of rooms)
    for (const night of room.nights) {
      gross += night.grossAmount;
      commission += night.commissionAmount;
    }
  return { gross, commission };
}

/** Kế hoạch phân bổ tất định: `roomCount` đơn vị bán × mọi đêm của quote. */
export function planSnapshot(source: SnapshotSource): SnapshotPlan {
  const { quote } = source;
  const nights = quote.nights.length;
  const weights: bigint[] = [];
  for (let room = 0; room < source.roomCount; room++)
    for (const night of quote.nights) weights.push(BigInt(night.nightlyPrice));
  const cells = allocate(BigInt(quote.total), weights);
  const rooms = Array.from({ length: source.roomCount }, (_, room) => {
    const planned = quote.nights.map((night, index) =>
      planNight(source, night.date, cells[room * nights + index]!),
    );
    const roomTotal = planned.reduce((total, night) => total + night.grossAmount, 0n);
    return { nights: planned, pricePerNight: roomTotal / BigInt(nights) };
  });
  const totals = totalsOf(rooms);
  return {
    rooms,
    grossAmount: totals.gross,
    commissionAmount: totals.commission,
    channelPropertySettingId: rooms[0]?.nights[0]?.channelSettingId ?? null,
  };
}

export type JsonRecord = Prisma.InputJsonObject;

/** `payload_json` của snapshot ORIGINAL; `roomIds` theo đúng thứ tự `plan.rooms`. */
export function snapshotPayload(
  source: SnapshotSource,
  plan: SnapshotPlan,
  roomIds: readonly string[],
): JsonRecord {
  const { quote } = source;
  return {
    schemaVersion: PRICE_SNAPSHOT_SCHEMA_VERSION,
    engineVersion: quote.engineVersion,
    quoteId: source.quoteId,
    quoteFingerprint: source.quoteFingerprint,
    channelCode: source.channelCode,
    ratePlan: { ...source.ratePlan },
    policy: { ...source.policy, tiers: source.policy.tiers.map((tier) => ({ ...tier })) },
    stay: {
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      timezone: source.stay.timezone,
      checkInTime: source.stay.checkInTime,
      checkOutTime: source.stay.checkOutTime,
    },
    nights: plan.rooms.flatMap((room, index) =>
      quote.nights.map((quoted, nightIndex) => {
        const planned = room.nights[nightIndex]!;
        return {
          bookingRoomId: roomIds[index]!,
          date: quoted.date,
          grossAmount: jsonAmount(planned.grossAmount),
          commissionAmount: jsonAmount(planned.commissionAmount),
          commissionPercent: planned.commissionPercent,
          // Nguồn giá của đêm (BR-RATE-01/17): giữ nguyên mọi bước engine đã dùng để đối chiếu lại.
          nightlyPrice: quoted.nightlyPrice,
          basePrice: quoted.basePrice,
          seasonMultiplier: quoted.seasonMultiplier,
          weekendMultiplier: quoted.weekendMultiplier,
          occupancyMultiplier: quoted.occupancyMultiplier,
          losMultiplier: quoted.losMultiplier,
          channelMultiplier: quoted.channelMultiplier,
          clamped: quoted.clamped,
          channelSettingId: planned.channelSettingId,
        };
      }),
    ),
    totals: {
      subtotal: quote.subtotal,
      discountAmount: quote.discountAmount,
      grossAmount: jsonAmount(plan.grossAmount),
      commissionAmount: jsonAmount(plan.commissionAmount),
      depositAmount: quote.depositAmount,
      currency: quote.currency,
    },
  };
}

/** Tiền trong JSON của snapshot là số (dữ liệu tiền của hợp đồng); chặn giá trị ngoài dải an toàn. */
function jsonAmount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Snapshot amount outside the safe integer range');
  return Number(value);
}
