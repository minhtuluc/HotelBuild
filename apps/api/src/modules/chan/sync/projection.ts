import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

/** Ba kênh OTA có quota riêng; kênh trực tiếp (WEB/PHONE/WALKIN) bán theo tồn chung, AGENCY cần cấu hình. */
export const OTA_CHANNEL_CODES = ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'] as const;

export type OtaChannelCode = (typeof OTA_CHANNEL_CODES)[number];

const OTA_CHANNEL_SET: ReadonlySet<string> = new Set(OTA_CHANNEL_CODES);

/** Thu hẹp kiểu cho nhánh nghiệp vụ OTA (quota/đóng bán) — kênh trực tiếp không đi qua đây. */
export function isOtaChannelCode(code: string): code is OtaChannelCode {
  return OTA_CHANNEL_SET.has(code);
}

/** BR-CHAN-01 / BR-INV-05: mặc định hạn mức OTA = 80% đơn vị bán đang hoạt động, **không** giữ 20% cho kênh trực tiếp. */
export const DEFAULT_ALLOTMENT_PCT = 80;

/** Lý do đóng bán tự động khi tồn khả dụng chạm ngưỡng thấp. */
export const AUTO_CLOSURE_REASON = 'AUTO_LOW_INVENTORY';

/** BR-CHAN-05 — ngưỡng mặc định của `channel.lowInventoryThreshold` khi SystemSetting chưa có. */
export const DEFAULT_LOW_INVENTORY_THRESHOLD = 2;

/** Tồn một đêm của một loại phòng, không phụ thuộc kênh (quota là phần trăm của `units`). */
export interface SupplyNight {
  readonly roomTypeId: string;
  readonly date: string;
  readonly units: number;
  readonly booked: number;
}

export interface AutoClosureResult {
  readonly closed: number;
  readonly changed: number;
}

/**
 * Quota của một kênh trên một đêm: `floor(units × pct%)`, tối thiểu 1 khi còn đơn vị bán, 0 khi hết
 * (BR-CHAN-01). Không bao giờ vượt sức chứa vật lý nên trigger `trg_channel_allotments_capacity` chấp nhận.
 */
export function quotaFor(units: number, pct: number): number {
  return units > 0 ? Math.max(1, Math.floor((units * pct) / 100)) : 0;
}

interface SupplyRow {
  readonly room_type_id: string;
  readonly day: string;
  readonly units: number;
  readonly booked: number;
}

/**
 * Số đơn vị bán đang hoạt động và số đơn vị đã có cam kết hiệu lực trên từng đêm của khoảng `[from,to)`
 * — cùng định nghĩa "đơn vị bán" với engine tồn (giường của phòng ở ghép, phòng của loại thường) và
 * cùng tập cam kết hiệu lực (CONFIRMED/CHECKED_IN, hoặc hold còn hạn).
 */
export async function nightlySupply(
  tx: PrismaTypes.TransactionClient,
  roomTypeIds: readonly string[],
  from: string,
  to: string,
): Promise<readonly SupplyNight[]> {
  if (roomTypeIds.length === 0 || from >= to) return [];
  const rows = await tx.$queryRaw<SupplyRow[]>(Prisma.sql`
    WITH dates AS (
      SELECT generate_series(${from}::date, ${to}::date - 1, interval '1 day')::date AS day
    ),
    sellable AS (
      SELECT r.room_type_id,
             sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::int AS units
        FROM rooms r
        JOIN room_types rt ON rt.id = r.room_type_id
        JOIN properties p ON p.id = rt.property_id
       WHERE r.room_type_id = ANY(${roomTypeIds}::uuid[])
         AND r.status = 'ACTIVE' AND rt.status = 'ACTIVE' AND p.status = 'ACTIVE'
       GROUP BY r.room_type_id
    ),
    demand AS (
      SELECT br.room_type_id, dates.day, count(DISTINCT br.id)::int AS booked
        FROM booking_rooms br
        JOIN bookings b ON b.id = br.booking_id
        JOIN dates ON dates.day >= b.check_in AND dates.day < b.check_out
       WHERE br.room_type_id = ANY(${roomTypeIds}::uuid[])
         AND (b.status IN ('CONFIRMED','CHECKED_IN')
              OR (b.status IN ('HELD','PENDING_PAYMENT') AND b.hold_expires_at > now()))
       GROUP BY br.room_type_id, dates.day
    ),
    types AS (SELECT unnest(${roomTypeIds}::uuid[]) AS room_type_id)
    SELECT t.room_type_id, to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(s.units, 0)::int AS units, COALESCE(dm.booked, 0)::int AS booked
      FROM types t
      CROSS JOIN dates d
      LEFT JOIN sellable s ON s.room_type_id = t.room_type_id
      LEFT JOIN demand dm ON dm.room_type_id = t.room_type_id AND dm.day = d.day
     ORDER BY t.room_type_id, d.day`);
  return rows.map((row) => ({
    roomTypeId: row.room_type_id,
    date: row.day,
    units: Number(row.units),
    booked: Number(row.booked),
  }));
}

/** `allotmentPct` của ánh xạ (kênh, loại phòng); chưa cấu hình ⇒ 80% theo BR-CHAN-01. */
export async function allotmentPct(
  tx: PrismaTypes.TransactionClient,
  channelId: string,
  roomTypeId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ allotment_pct: number }[]>(Prisma.sql`
    SELECT allotment_pct FROM channel_mappings
     WHERE channel_id = ${channelId}::uuid AND room_type_id = ${roomTypeId}::uuid`);
  const value = rows[0]?.allotment_pct;
  return typeof value === 'number' ? Number(value) : DEFAULT_ALLOTMENT_PCT;
}

/** BR-SYS-02: ngưỡng đọc từ `SystemSetting`, đổi được không cần triển khai lại. */
export async function lowInventoryThreshold(tx: PrismaTypes.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<{ value: string }[]>(Prisma.sql`
    SELECT value FROM system_settings WHERE key = 'channel.lowInventoryThreshold'`);
  const parsed = Number.parseInt(rows[0]?.value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_LOW_INVENTORY_THRESHOLD;
}

/**
 * Ghi lại kết quả tính tồn cho **mọi** kênh OTA (BR-CHAN-05/06):
 *
 * - `pool = units - booked ≤ ngưỡng` ⇒ tạo/duy trì đóng bán **tự động** trên đúng `(loại phòng, đêm)`.
 *   `is_closed` là cờ hiệu lực mà loader tồn đọc; `manual_closed`/`auto_closed` giữ provenance riêng nên
 *   lần sync sau chỉ gỡ được phần tự động.
 * - `pool > ngưỡng` ⇒ chỉ **gỡ** cờ tự động của hàng đã tồn tại và không tạo hàng mới (không ghi quota
 *   thô cho mọi đêm — OTA chỉ thấy tồn đã kẹp quota qua `channel_allotments` khi thật sự có cấu hình).
 *
 * `used` không bao giờ bị sửa ở đây: cam kết OTA đã xác nhận có thể khiến `used > allotment`.
 */
export async function applyAutoClosures(
  tx: PrismaTypes.TransactionClient,
  channels: readonly { readonly id: string }[],
  roomTypeIds: readonly string[],
  from: string,
  to: string,
): Promise<AutoClosureResult> {
  const nights = await nightlySupply(tx, roomTypeIds, from, to);
  if (nights.length === 0 || channels.length === 0) return { closed: 0, changed: 0 };
  const threshold = await lowInventoryThreshold(tx);
  let closed = 0;
  let changed = 0;
  for (const channel of channels) {
    const pctRows = await tx.$queryRaw<{ room_type_id: string; allotment_pct: number }[]>(
      Prisma.sql`SELECT room_type_id, allotment_pct FROM channel_mappings
                  WHERE channel_id = ${channel.id}::uuid AND room_type_id = ANY(${roomTypeIds}::uuid[])`,
    );
    const pctByType = new Map(
      pctRows.map((row) => [row.room_type_id, Number(row.allotment_pct)] as const),
    );
    for (const night of nights) {
      const quota = quotaFor(night.units, pctByType.get(night.roomTypeId) ?? DEFAULT_ALLOTMENT_PCT);
      if (night.units - night.booked <= threshold) {
        const affected = await tx.$executeRaw(Prisma.sql`
          INSERT INTO channel_allotments(
            channel_id, room_type_id, date, allotment, is_closed, closed_reason, closed_at,
            auto_closed, manual_closed)
          VALUES (${channel.id}::uuid, ${night.roomTypeId}::uuid, ${night.date}::date, ${quota},
                  true, ${AUTO_CLOSURE_REASON}, clock_timestamp(), true, false)
          ON CONFLICT (channel_id, room_type_id, date) DO UPDATE
             SET allotment = EXCLUDED.allotment,
                 auto_closed = true,
                 is_closed = true,
                 closed_reason = CASE WHEN channel_allotments.manual_closed
                                      THEN channel_allotments.closed_reason
                                      ELSE EXCLUDED.closed_reason END,
                 closed_at = COALESCE(channel_allotments.closed_at, EXCLUDED.closed_at)`);
        if (affected > 0) closed += 1;
        changed += affected;
        continue;
      }
      const affected = await tx.$executeRaw(Prisma.sql`
        UPDATE channel_allotments
           SET allotment = ${quota},
               auto_closed = false,
               is_closed = manual_closed,
               closed_reason = CASE WHEN manual_closed THEN closed_reason ELSE NULL END
         WHERE channel_id = ${channel.id}::uuid
           AND room_type_id = ${night.roomTypeId}::uuid
           AND date = ${night.date}::date
           AND (auto_closed OR allotment <> ${quota})`);
      changed += affected;
    }
  }
  return { closed, changed };
}
