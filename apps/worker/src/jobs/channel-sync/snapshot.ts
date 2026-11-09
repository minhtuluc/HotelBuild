import type { PrismaClient } from '@prisma/client';
import { SNAPSHOT_HORIZON_DAYS } from './contract.js';

/** Một đêm của ảnh tồn đẩy sang OTA — số tuyệt đối **đã kẹp quota**, không phải allotment thô. */
export interface InventoryNight {
  readonly roomTypeId: string;
  readonly date: string;
  readonly supply: number;
  readonly pool: number;
  readonly quota: number;
  readonly used: number;
  readonly available: number;
}

export interface ChannelSnapshotBody {
  readonly channelId: string;
  readonly channelCode: string;
  readonly snapshot: {
    readonly key: string;
    readonly version: number;
    readonly inventory: readonly InventoryNight[];
  };
}

export interface ChannelIdentity {
  readonly id: string;
  readonly code: string;
  readonly version: bigint;
}

/**
 * BR-CHAN-01: mặc định từng OTA = `floor(allotment_pct% × đơn vị ACTIVE)` (ánh xạ kênh, HB-224; 80 khi
 * thiếu), tối thiểu 1 khi còn bán được; `0%` ⇒ không bán. Gương của `otaQuota` trong `@pinehill/domain`.
 */
function defaultOtaQuota(units: number, pct: number): number {
  if (units <= 0 || pct <= 0) return 0;
  return Math.max(1, Math.floor((units * pct) / 100));
}

interface InventoryRow {
  readonly room_type_id: string;
  readonly day: string;
  readonly units: number;
  readonly booked: number;
  readonly used: number;
  readonly allotment: number | null;
  readonly is_closed: boolean | null;
  readonly allotment_pct: number;
}

/**
 * Ảnh tồn của **một kênh**: mọi loại phòng đang có ánh xạ ACTIVE, `SNAPSHOT_HORIZON_DAYS` đêm kể từ
 * `today`. `available = max(0, min(pool, quota - used))` — cam kết OTA đã xác nhận có thể khiến
 * `used > quota` (BR-CHAN-03) nên tồn công bố luôn kẹp không âm và không bao giờ vượt `pool`.
 *
 * `key` gắn với kênh + version nên hai lượt phát lại cùng version sinh **đúng cùng một thân** (at-least-once
 * mà không nhân đôi tác dụng); version cũ không ghi đè ảnh mới vì consumer so `snapshot.version`.
 */
export async function buildSnapshot(
  db: PrismaClient,
  channel: ChannelIdentity,
  version: number,
  today: string,
): Promise<ChannelSnapshotBody> {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + SNAPSHOT_HORIZON_DAYS);
  const to = end.toISOString().slice(0, 10);
  const rows = await db.$queryRaw<InventoryRow[]>`
    WITH dates AS (
      SELECT generate_series(${today}::date, ${to}::date - 1, interval '1 day')::date AS day
    ),
    mapped AS (
      SELECT m.room_type_id, m.allotment_pct FROM channel_mappings m
       WHERE m.channel_id = ${channel.id}::uuid AND m.status = 'ACTIVE'
    ),
    sellable AS (
      SELECT r.room_type_id,
             sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::int AS units
        FROM rooms r
        JOIN room_types rt ON rt.id = r.room_type_id
        JOIN mapped m ON m.room_type_id = r.room_type_id
       WHERE r.status = 'ACTIVE' AND rt.status = 'ACTIVE'
       GROUP BY r.room_type_id
    ),
    demand AS (
      SELECT br.room_type_id, dates.day, b.channel_id, count(DISTINCT br.id)::int AS rooms
        FROM booking_rooms br
        JOIN bookings b ON b.id = br.booking_id
        JOIN dates ON dates.day >= b.check_in AND dates.day < b.check_out
        JOIN mapped m ON m.room_type_id = br.room_type_id
       WHERE b.status IN ('CONFIRMED','CHECKED_IN')
          OR (b.status IN ('HELD','PENDING_PAYMENT') AND b.hold_expires_at > now())
       GROUP BY br.room_type_id, dates.day, b.channel_id
    ),
    allot AS (
      SELECT a.room_type_id, a.date, a.allotment, a.is_closed
        FROM channel_allotments a
       WHERE a.channel_id = ${channel.id}::uuid
    )
    SELECT m.room_type_id, to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(s.units, 0)::int AS units,
           COALESCE((SELECT sum(dm.rooms) FROM demand dm
                      WHERE dm.room_type_id = m.room_type_id AND dm.day = d.day), 0)::int AS booked,
           COALESCE((SELECT dm.rooms FROM demand dm
                      WHERE dm.room_type_id = m.room_type_id AND dm.day = d.day
                        AND dm.channel_id = ${channel.id}::uuid), 0)::int AS used,
           a.allotment, a.is_closed, m.allotment_pct
      FROM mapped m
      CROSS JOIN dates d
      LEFT JOIN sellable s ON s.room_type_id = m.room_type_id
      LEFT JOIN allot a ON a.room_type_id = m.room_type_id AND a.date = d.day
     ORDER BY m.room_type_id, d.day`;
  const inventory = rows.map((row) => {
    const units = Number(row.units);
    const used = Number(row.used);
    const pool = units - Number(row.booked);
    const quota =
      row.is_closed === true
        ? 0
        : (row.allotment ??
          (channel.code === 'AGENCY' ? 0 : defaultOtaQuota(units, Number(row.allotment_pct))));
    return {
      roomTypeId: row.room_type_id,
      date: row.day,
      supply: units,
      pool,
      quota: Number(quota),
      used,
      available: Math.max(0, Math.min(pool, Number(quota) - used)),
    };
  });
  return {
    channelId: channel.id,
    channelCode: channel.code,
    snapshot: { key: `${channel.code}:${version}`, version, inventory },
  };
}

/**
 * Gửi ảnh sang adapter ở **ranh giới mạng**: 2xx là thành công, mọi mã khác hoặc lỗi kết nối là thất bại.
 * Không trả/ném nội dung phản hồi để log và `last_error` chỉ còn mã ổn định (NFR-SEC-04).
 */
export async function pushSnapshot(baseUrl: string, body: ChannelSnapshotBody): Promise<boolean> {
  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
