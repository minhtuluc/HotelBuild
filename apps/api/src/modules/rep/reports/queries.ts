import { Prisma } from '@prisma/client';

/**
 * Truy vấn tổng hợp cho 6 báo cáo REP (api.md §2.12). Mọi phép cộng/đếm chạy **trong CSDL**; ứng dụng
 * chỉ nhận dòng đã gộp theo (cơ sở, loại phòng, ngày) — không kéo toàn bộ booking về (HB-162 AC1).
 *
 * Quy ước thời gian: `check_in`, `check_out`, `stay_date`, `room_blocks.*`, `overbooking_cases.date`
 * là **ngày nghiệp vụ** (`date`) nên so trực tiếp; `created_at`/`cancelled_at` là mốc UTC nên quy về
 * ngày nghiệp vụ bằng `AT TIME ZONE` (NFR-LOC-02).
 */

/** Dòng tổng hợp phòng-đêm thô: mức mịn nhất (cơ sở × loại phòng × ngày). */
export interface RoomNightAggregate {
  readonly property_id: string;
  readonly room_type_id: string;
  readonly d: Date;
  readonly available: bigint;
  readonly sold: bigint;
  readonly net: bigint;
}

function nightSeries(from: string, to: string): Prisma.Sql {
  return Prisma.sql`SELECT gs::date AS d
    FROM generate_series(${from}::date, ${to}::date - 1, interval '1 day') AS gs`;
}

/** Mệnh đề lọc phải dựng theo **bí danh** của từng CTE (phạm vi cơ sở trỏ vào cột khác nhau). */
export type ScopedFilter = (propertyColumn: Prisma.Sql) => Prisma.Sql;

/**
 * Phòng-đêm khả dụng: phòng `ACTIVE` (kèm loại phòng và cơ sở `ACTIVE`), DOR đếm theo **giường**
 * (BR-PROP-03/04), trừ nguyên phòng khi có `room_blocks` phủ ngày đó (BR-REP-01).
 */
function availableUnits(from: string, to: string, filter: ScopedFilter): Prisma.Sql {
  return Prisma.sql`
    SELECT r.property_id AS property_id, r.room_type_id AS room_type_id, n.d AS d,
           sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::bigint AS available
      FROM rooms r
      JOIN room_types rt ON rt.id = r.room_type_id
      JOIN properties p ON p.id = r.property_id
      JOIN (${nightSeries(from, to)}) n ON true
     WHERE r.status = 'ACTIVE' AND rt.status = 'ACTIVE' AND p.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM room_blocks rb
                        WHERE rb.room_id = r.id AND n.d >= rb.start_date AND n.d < rb.end_date)
       ${filter(Prisma.sql`r.property_id`)}
     GROUP BY 1,2,3`;
}

/** Phòng-đêm đã bán: một dòng `booking_rooms` của booking đã xác nhận/đã ở = một đơn vị bán mỗi đêm. */
function soldUnits(from: string, to: string, filter: ScopedFilter): Prisma.Sql {
  return Prisma.sql`
    SELECT b.property_id AS property_id, br.room_type_id AS room_type_id, n.d AS d,
           count(*)::bigint AS sold
      FROM booking_rooms br
      JOIN bookings b ON b.id = br.booking_id
      JOIN (${nightSeries(from, to)}) n ON n.d >= b.check_in AND n.d < b.check_out
     WHERE b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')
       AND br.status <> 'CANCELLED'
       ${filter(Prisma.sql`b.property_id`)}
     GROUP BY 1,2,3`;
}

/**
 * Doanh thu phòng **thuần** theo phòng-đêm: `booking_charges.kind = 'ROOM'` trừ hoa hồng của **chính
 * dòng đêm** trong snapshot giá mới nhất (`payload_json->'nights'` gồm `bookingRoomId`/`date`/
 * `grossAmount`/`commissionAmount` — csdl §3.6), không nhân tỷ lệ hoa hồng gộp của cả booking.
 * Hoa hồng của dòng đêm được phân bổ theo tỷ lệ nghĩa vụ thực tế của đêm đó rồi làm tròn HALF_UP một
 * lần; booking thiếu snapshot coi hoa hồng 0 (không đọc cấu hình kênh hiện tại).
 */
function netRoomRevenue(from: string, to: string, filter: ScopedFilter): Prisma.Sql {
  return Prisma.sql`
    SELECT b.property_id AS property_id, br.room_type_id AS room_type_id, ch.stay_date AS d,
           sum(
             (ch.amount - ch.voided_amount)
             - CASE WHEN night.gross_amount > 0
                    THEN ((2::bigint * (ch.amount - ch.voided_amount) * night.commission_amount)
                          + night.gross_amount) / (2::bigint * night.gross_amount)
                    ELSE 0 END
           )::bigint AS net
      FROM booking_charges ch
      JOIN booking_rooms br ON br.id = ch.booking_room_id
      JOIN bookings b ON b.id = ch.booking_id
      LEFT JOIN LATERAL (
        SELECT s.payload_json FROM price_snapshots s
         WHERE s.booking_id = b.id ORDER BY s.seq DESC LIMIT 1
      ) snap ON true
      LEFT JOIN LATERAL (
        SELECT (n->>'grossAmount')::bigint AS gross_amount,
               (n->>'commissionAmount')::bigint AS commission_amount
          FROM jsonb_array_elements(coalesce(snap.payload_json->'nights', '[]'::jsonb)) AS n
         WHERE n->>'bookingRoomId' = ch.booking_room_id::text
           AND n->>'date' = ch.stay_date::text
         LIMIT 1
      ) night ON true
     WHERE ch.kind = 'ROOM' AND ch.stay_date IS NOT NULL
       AND ch.stay_date >= ${from}::date AND ch.stay_date < ${to}::date
       AND b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')
       ${filter(Prisma.sql`b.property_id`)}
     GROUP BY 1,2,3`;
}

/**
 * Phòng-đêm khả dụng/đã bán/doanh thu thuần cho một kỳ, gộp ở mức cơ sở × loại phòng × ngày.
 * `filter` là mệnh đề phạm vi cơ sở (+ lọc cơ sở cụ thể) do `service` dựng, theo bí danh từng CTE.
 */
export function roomNightAggregates(from: string, to: string, filter: ScopedFilter): Prisma.Sql {
  return Prisma.sql`
    WITH avail AS (${availableUnits(from, to, filter)}),
         sold AS (${soldUnits(from, to, filter)}),
         net AS (${netRoomRevenue(from, to, filter)}),
         keys AS (
           SELECT property_id, room_type_id, d FROM avail
           UNION SELECT property_id, room_type_id, d FROM sold
           UNION SELECT property_id, room_type_id, d FROM net
         )
    SELECT k.property_id, k.room_type_id, k.d,
           coalesce(a.available, 0)::bigint AS available,
           coalesce(s.sold, 0)::bigint AS sold,
           coalesce(n.net, 0)::bigint AS net
      FROM keys k
      LEFT JOIN avail a ON a.property_id = k.property_id AND a.room_type_id = k.room_type_id AND a.d = k.d
      LEFT JOIN sold s ON s.property_id = k.property_id AND s.room_type_id = k.room_type_id AND s.d = k.d
      LEFT JOIN net n ON n.property_id = k.property_id AND n.room_type_id = k.room_type_id AND n.d = k.d
     ORDER BY k.property_id, k.room_type_id, k.d`;
}

export interface ChannelRevenueRow {
  readonly channel_code: string;
  readonly gross: bigint;
  readonly commission: bigint;
  readonly bookings: bigint;
}

/**
 * Doanh thu gộp/thuần theo kênh — theo mẫu csdl Q5: snapshot **mới nhất** của booking đã xác nhận/đã ở,
 * không đọc cấu hình kênh hiện tại; huỷ/no-show/expired tách riêng nên không trừ vào doanh thu.
 */
export function channelRevenue(from: string, to: string, filter: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH realized AS (
      SELECT b.channel_id, sum(ps.gross_amount)::bigint AS gross,
             sum(ps.commission_amount)::bigint AS commission, count(*)::bigint AS bookings
        FROM bookings b
        LEFT JOIN LATERAL (SELECT s.gross_amount, s.commission_amount
          FROM price_snapshots s WHERE s.booking_id = b.id ORDER BY s.seq DESC LIMIT 1) ps ON true
       WHERE b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')
         AND b.check_in >= ${from}::date AND b.check_in < ${to}::date
         ${filter}
       GROUP BY b.channel_id
    )
    SELECT ch.code AS channel_code,
           coalesce(rz.gross, 0)::bigint AS gross,
           coalesce(rz.commission, 0)::bigint AS commission,
           coalesce(rz.bookings, 0)::bigint AS bookings
      FROM channels ch
      LEFT JOIN realized rz ON rz.channel_id = ch.id
     WHERE ch.status <> 'INACTIVE'
     ORDER BY ch.code`;
}

export interface CancellationRateRow {
  readonly cancelled: bigint;
  readonly created: bigint;
}

/** Tỷ lệ huỷ theo BR-REP-01: booking `CANCELLED` ÷ tổng booking **tạo trong kỳ** (ngày nghiệp vụ VN). */
export function cancellationRate(
  from: string,
  to: string,
  timezone: string,
  filter: Prisma.Sql,
  ratePlan: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*) FILTER (WHERE b.status = 'CANCELLED')::bigint AS cancelled,
           count(*)::bigint AS created
      FROM bookings b
      JOIN rate_plans rp ON rp.id = b.rate_plan_id
     WHERE (b.created_at AT TIME ZONE ${timezone})::date >= ${from}::date
       AND (b.created_at AT TIME ZONE ${timezone})::date < ${to}::date
       ${filter}
       ${ratePlan}`;
}

export interface CancellationTierRow {
  readonly rate_plan_code: string;
  readonly tier_hours: number;
  readonly cancellations: bigint;
  readonly refund: bigint;
}

/**
 * Huỷ theo bậc chính sách: mỗi `refund_requests` của booking đã huỷ trong kỳ, gộp theo (gói giá, bậc).
 * Bậc trả về **nguyên giá trị canonical** (`cancellation_tiers.offset_hours`, bậc bắt tất là `-1` —
 * csdl §3.6); yêu cầu chưa gắn bậc chính sách không thuộc bảng này. Tiền hoàn = `net_refund` đã
 * duyệt/đã chi; yêu cầu bị từ chối/rút và ca bất khả kháng (báo cáo riêng) không tính.
 */
export function cancellationTiers(
  from: string,
  to: string,
  timezone: string,
  filter: Prisma.Sql,
  ratePlan: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    SELECT rp.code AS rate_plan_code,
           t.offset_hours AS tier_hours,
           count(DISTINCT b.id)::bigint AS cancellations,
           sum(coalesce(rr.net_refund, rr.approved_amount, rr.requested_amount, 0))::bigint AS refund
      FROM refund_requests rr
      JOIN bookings b ON b.id = rr.booking_id
      JOIN rate_plans rp ON rp.id = b.rate_plan_id
      JOIN cancellation_tiers t ON t.id = rr.applied_tier_id
     WHERE b.status = 'CANCELLED'
       AND coalesce(rr.status, '') IN ('APPROVED','PAID')
       AND rr.is_force_majeure = false
       AND (b.cancelled_at AT TIME ZONE ${timezone})::date >= ${from}::date
       AND (b.cancelled_at AT TIME ZONE ${timezone})::date < ${to}::date
       ${filter}
       ${ratePlan}
     GROUP BY 1,2
     ORDER BY 1,2`;
}

export interface ForceMajeureRow {
  readonly booking_id: string;
  readonly property_id: string;
  readonly cancelled_at: Date;
  readonly refund: bigint;
  readonly note: string | null;
}

/** Bất khả kháng (BR-CANCEL-13): mọi yêu cầu hoàn gắn cờ `is_force_majeure` trong kỳ, kèm lý do. */
export function forceMajeureRows(
  from: string,
  to: string,
  timezone: string,
  filter: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    SELECT rr.booking_id, b.property_id, b.cancelled_at,
           coalesce(rr.net_refund, rr.approved_amount, rr.requested_amount, 0)::bigint AS refund,
           b.note AS note
      FROM refund_requests rr
      JOIN bookings b ON b.id = rr.booking_id
     WHERE rr.is_force_majeure = true
       AND (b.cancelled_at AT TIME ZONE ${timezone})::date >= ${from}::date
       AND (b.cancelled_at AT TIME ZONE ${timezone})::date < ${to}::date
       ${filter}
     ORDER BY b.cancelled_at, rr.booking_id`;
}

export interface OverbookingRow {
  readonly case_id: string;
  readonly property_id: string;
  readonly room_type_id: string;
  readonly business_date: Date;
  readonly status: string;
  readonly detected_at: Date;
  readonly resolved_at: Date | null;
  readonly merge_discount: bigint;
  readonly walk_out: bigint;
  readonly transport: bigint;
}

/**
 * Quá tải (BR-OVER-04/05/15/16, UC-REP-04): mỗi ca kèm ba khoản chi phí xử lý. Chi phí gắn với ca theo
 * (cơ sở, ngày thiếu phòng): ghép phòng `ACTIVE` mà booking ghép đang ở trong ngày đó; walk-out
 * `EXECUTED` của booking thuộc cơ sở trong ngày đó.
 */
export function overbookingCases(
  from: string,
  to: string,
  filter: Prisma.Sql,
  status: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    WITH cases AS (
      SELECT c.id, c.property_id, c.room_type_id, c.date, c.status, c.detected_at, c.resolved_at
        FROM overbooking_cases c
       WHERE c.date >= ${from}::date AND c.date < ${to}::date
         ${filter}
         ${status}
    ),
    merges AS (
      SELECT c.id AS case_id, sum(rm.discount_amount)::bigint AS merge_discount
        FROM cases c
        JOIN bookings pb ON pb.property_id = c.property_id
                        AND pb.room_type_id = c.room_type_id
                        AND pb.check_in <= c.date AND pb.check_out > c.date
        JOIN room_merges rm ON rm.primary_booking_id = pb.id AND rm.status = 'ACTIVE'
       GROUP BY c.id
    ),
    walks AS (
      SELECT c.id AS case_id,
             sum(mv.compensation_amount)::bigint AS walk_out,
             sum(coalesce(mv.transport_cost, 0))::bigint AS transport
        FROM cases c
        JOIN bookings b ON b.property_id = c.property_id
                       AND b.room_type_id = c.room_type_id
                       AND b.check_in <= c.date AND b.check_out > c.date
        JOIN room_moves mv ON mv.booking_id = b.id AND mv.status = 'EXECUTED'
                          AND mv.move_type = 'WALK_OUT'
       GROUP BY c.id
    )
    SELECT c.id AS case_id, c.property_id, c.room_type_id, c.date AS business_date, c.status,
           c.detected_at, c.resolved_at,
           coalesce(mg.merge_discount, 0)::bigint AS merge_discount,
           coalesce(wk.walk_out, 0)::bigint AS walk_out,
           coalesce(wk.transport, 0)::bigint AS transport
      FROM cases c
      LEFT JOIN merges mg ON mg.case_id = c.id
      LEFT JOIN walks wk ON wk.case_id = c.id
     ORDER BY c.date, c.id`;
}
