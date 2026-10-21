/**
 * Ghi nhận khách không đến theo nhịp (HB-147; BR-CANCEL-10, BR-CANCEL-06, BR-FO-02).
 *
 * Hàng đợi chỉ là **nhịp chạy**: payload không mang dữ liệu nghiệp vụ, danh sách ứng viên đọc từ
 * PostgreSQL (giờ CSDL) nên mất job trên Redis hay khởi động lại tiến trình đều không làm booking
 * "sống lại" (cùng lối với `q.hold-expiry`/`q.outbox-relay`).
 *
 * **Vì sao lặp lại phần nghiệp vụ ở worker:** `apps/worker` không dùng chung package với `apps/api`
 * (worker không phụ thuộc `@pinehill/domain`), nên job phải áp đúng cùng luật ở tầng SQL. Ba điểm được
 * giữ khớp với nguồn chân lý và có test pin:
 * - bậc áp dụng = **bậc bắt tất cuối** của `price_snapshots.policy_snapshot_json` (BR-CANCEL-10);
 * - `penalty = max(0, firstNightPrice − paidAmount)` (BR-CANCEL-06) với `paidAmount` chia theo trọng số
 *   phòng như `packages/domain/src/cancellation/allocation.ts#allocatePayment`;
 * - khoản phạt ghi **cùng hình dạng** với `recordPenalty` của `apps/api/src/modules/book/cancel/writes.ts`
 *   (`booking_charges` PENALTY + `payments` PENALTY PENDING, cùng `source_key` ⇒ ràng buộc UNIQUE chặn
 *   ghi lần hai khi lệnh tay và job chạy đua nhau).
 *
 * Khoá và thời gian theo ADR-014/BR-BOOK-18: khoá `bookings` `FOR UPDATE` (không `SKIP LOCKED`), đọc lại
 * trạng thái + mốc bằng `clock_timestamp()`, rồi mới ghi; mỗi booking một transaction để một hàng hỏng
 * không kéo cả lượt quét xuống.
 */
import type { PrismaClient } from '@prisma/client';
import type { JobContext } from '../types.js';

export const NO_SHOW_QUEUE = 'q.no-show-mark';
/** Lý do ghi vào `room_assignments.release_reason` + `booking_status_history.reason` (BR-CANCEL-10). */
export const NO_SHOW_REASON = 'NO_SHOW';
/** Hành động ghi nhật ký (`audit_logs.action`) — BR-GEN-07. */
export const NO_SHOW_ACTION = 'BOOKING_NO_SHOW';
/** Loại sự kiện cổng ra — cùng loại với luồng giữ chỗ/hết hạn/huỷ. */
export const NO_SHOW_EVENT = 'InventoryChanged';
/** BR-CANCEL-10 tính mốc theo giờ địa phương của cơ sở; chuỗi này là múi giờ nghiệp vụ đã chốt. */
export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
/** Snapshot giá/chính sách thiếu hoặc hỏng: dừng, không đoán bậc/phạt (fail closed). */
export const POLICY_MISSING = 'NO_SHOW_POLICY_MISSING';

export interface MarkOptions {
  /** Mốc giờ trong ngày coi là "hết ngày nhận phòng" (`HH:MM` hoặc `HH:MM:SS`, BR-SYS-02). */
  readonly markTime: string;
  /** Số booking mỗi trang. */
  readonly batchSize: number;
  /** Trần số trang mỗi lượt (nhịp ngắn giữ lượt chạy ngắn khi tồn đọng bất thường). */
  readonly maxPages: number;
}

export interface MarkReport {
  readonly scanned: number;
  readonly marked: number;
  /** Đã đổi trạng thái trước khi thấy khoá (thua đua tranh, hoặc lượt trước vừa xử lý). */
  readonly skipped: number;
  /** Lỗi của **một** booking; lượt sau quét lại (không nuốt lỗi, chỉ không chặn booking khác). */
  readonly failed: number;
  readonly releasedAssignments: number;
  readonly penaltyTotal: bigint;
  readonly pages: number;
}

export interface MarkOutcome {
  readonly marked: boolean;
  readonly fromStatus: string | null;
  readonly releasedAssignments: number;
  readonly penaltyAmount: bigint;
}

const SKIPPED: MarkOutcome = {
  marked: false,
  fromStatus: null,
  releasedAssignments: 0,
  penaltyAmount: 0n,
};

export interface RoomWeight {
  readonly bookingRoomId: string;
  readonly weight: bigint;
}

/**
 * Phần tiền đã thu được phân bổ cho các đơn vị bán đang chọn — bản gương của
 * `allocatePayment` (`packages/domain/src/cancellation/allocation.ts`): chia theo trọng số, phần dư
 * cộng lần lượt cho các phòng theo thứ tự id tăng dần.
 */
export function paidShare(
  rooms: readonly RoomWeight[],
  receipts: readonly bigint[],
  selected: ReadonlySet<string>,
): bigint {
  const ordered = [...rooms].sort((left, right) =>
    left.bookingRoomId < right.bookingRoomId ? -1 : 1,
  );
  const total = ordered.reduce((sum, room) => sum + room.weight, 0n);
  if (total === 0n) return 0n;
  let paid = 0n;
  for (const receipt of receipts) {
    const shares = ordered.map((room) => (receipt * room.weight) / total);
    let remainder = receipt - shares.reduce((sum, share) => sum + share, 0n);
    for (const [index, room] of ordered.entries()) {
      const extra = remainder > 0n ? 1n : 0n;
      remainder -= extra;
      if (selected.has(room.bookingRoomId)) paid += (shares[index] ?? 0n) + extra;
    }
  }
  return paid;
}

/** BR-CANCEL-06: `penaltyAmount = max(0, firstNightPrice − paidAmount)` của các phòng bị đánh dấu. */
export function firstNightPenalty(firstNight: bigint, paid: bigint): bigint {
  return firstNight > paid ? firstNight - paid : 0n;
}

/** Danh sách ứng viên: `CONFIRMED`, `check_in` là ngày nghiệp vụ hôm nay và đã qua mốc (giờ CSDL). */
export async function dueNoShowIds(
  db: PrismaClient,
  options: Pick<MarkOptions, 'markTime' | 'batchSize'>,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH now AS (SELECT clock_timestamp() AS at)
    SELECT b.id
      FROM bookings b, now
     WHERE b.status = 'CONFIRMED'
       AND b.check_in = (now.at AT TIME ZONE ${BUSINESS_TIMEZONE}::text)::date
       AND now.at >= ((b.check_in::timestamp + ${options.markTime}::time)
                      AT TIME ZONE ${BUSINESS_TIMEZONE}::text)
     ORDER BY b.seq
     LIMIT ${options.batchSize}`;
  return rows.map((row) => row.id);
}

interface BookingRow {
  readonly id: string;
  readonly property_id: string;
  readonly room_type_id: string;
  readonly check_in: Date;
  readonly check_out: Date;
  readonly status: string;
  readonly eligible: boolean;
}

interface RoomRow {
  readonly id: string;
  readonly weight: bigint;
  readonly first_night: bigint;
}

/**
 * Đánh dấu **một** booking trong một transaction. Trả `marked: false` khi trạng thái đã đổi hoặc mốc
 * chưa tới lúc đọc lại sau khoá (bên thắng đua tranh đã xử lý xong) — nhờ vậy chạy lại nhiều lần/nhiều
 * worker vẫn chỉ có một lần ghi.
 */
export async function markNoShow(
  db: PrismaClient,
  bookingId: string,
  markTime: string,
): Promise<MarkOutcome> {
  return db.$transaction(async (tx) => {
    // 1. Khoá booking trước (ADR-014) rồi mới đọc lại trạng thái + mốc bằng giờ CSDL.
    const booking = (
      await tx.$queryRaw<BookingRow[]>`
        WITH now AS (SELECT clock_timestamp() AS at)
        SELECT b.id, b.property_id, b.room_type_id, b.check_in, b.check_out, b.status,
               (now.at >= ((b.check_in::timestamp + ${markTime}::time)
                           AT TIME ZONE ${BUSINESS_TIMEZONE}::text)
                AND (now.at AT TIME ZONE ${BUSINESS_TIMEZONE}::text)::date = b.check_in) AS eligible
          FROM bookings b, now
         WHERE b.id = ${bookingId}::uuid
         FOR UPDATE OF b`
    )[0];
    if (booking === undefined || booking.status !== 'CONFIRMED' || !booking.eligible)
      return SKIPPED;
    const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const checkIn = booking.check_in.toISOString().slice(0, 10);

    // 2. Đơn vị bán đang hoạt động (khoá theo thứ tự id) + trọng số/giá đêm đầu từ nghĩa vụ ROOM.
    const active = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM booking_rooms
       WHERE booking_id = ${bookingId}::uuid AND status = 'ACTIVE'
       ORDER BY id FOR UPDATE`;
    if (active.length === 0) return SKIPPED;
    const rooms = await tx.$queryRaw<RoomRow[]>`
      SELECT br.id,
             coalesce(sum(c.amount), 0)::bigint AS weight,
             coalesce(sum(c.amount) FILTER (WHERE c.stay_date = ${checkIn}::date), 0)::bigint
               AS first_night
        FROM booking_rooms br
        JOIN booking_charges c ON c.booking_room_id = br.id AND c.kind = 'ROOM'
       WHERE br.booking_id = ${bookingId}::uuid AND br.status = 'ACTIVE'
       GROUP BY br.id
       ORDER BY br.id`;
    const selected = new Set(active.map((room) => room.id));
    const receipts = await tx.$queryRaw<{ amount: bigint }[]>`
      SELECT amount FROM payments
       WHERE booking_id = ${bookingId}::uuid AND status = 'SUCCEEDED'
         AND type IN ('DEPOSIT', 'BALANCE')
       ORDER BY id`;
    const firstNight = rooms.reduce(
      (sum, room) => (selected.has(room.id) ? sum + room.first_night : sum),
      0n,
    );
    const paid = paidShare(
      rooms.map((room) => ({ bookingRoomId: room.id, weight: room.weight })),
      receipts.map((receipt) => receipt.amount),
      selected,
    );
    // 3. Bậc bắt tất của snapshot hiện hành quyết định có phạt đêm đầu hay không (BR-CANCEL-10).
    const tier = (
      await tx.$queryRaw<{ charge_first_night: boolean }[]>`
        SELECT (tier ->> 'chargeFirstNight')::boolean AS charge_first_night
          FROM (SELECT policy_snapshot_json FROM price_snapshots
                 WHERE booking_id = ${bookingId}::uuid ORDER BY seq DESC LIMIT 1) snapshot
          CROSS JOIN LATERAL jsonb_array_elements(snapshot.policy_snapshot_json -> 'tiers') tier
         ORDER BY (tier ->> 'offsetHours')::int
         LIMIT 1`
    )[0];
    if (tier === undefined) throw new Error(POLICY_MISSING);
    const penalty = tier.charge_first_night ? firstNightPenalty(firstNight, paid) : 0n;

    // 4. Nhả phân công + void nghĩa vụ phòng; giữ tiền đã thu (bậc cuối hoàn 0%, BR-CANCEL-10/06).
    const assignments = await tx.$queryRaw<{ id: string; room_id: string }[]>`
      SELECT id, room_id FROM room_assignments
       WHERE booking_room_id = ANY(${[...selected]}::uuid[]) AND released_at IS NULL
       ORDER BY id FOR UPDATE`;
    if (assignments.length > 0)
      await tx.$executeRaw`
        UPDATE room_assignments SET released_at = ${now}, release_reason = ${NO_SHOW_REASON},
               updated_at = ${now}
         WHERE id = ANY(${assignments.map((row) => row.id)}::uuid[])`;
    await tx.$executeRaw`
      UPDATE payment_allocations SET released_amount = amount, release_reason = ${NO_SHOW_REASON},
             updated_at = ${now}
       WHERE released_amount < amount AND charge_id IN (
         SELECT id FROM booking_charges
          WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM'
            AND booking_room_id = ANY(${[...selected]}::uuid[]))`;
    await tx.$executeRaw`
      UPDATE booking_charges SET voided_amount = amount, reason = ${NO_SHOW_REASON},
             updated_at = ${now}
       WHERE voided_amount < amount AND booking_id = ${bookingId}::uuid AND kind = 'ROOM'
         AND booking_room_id = ANY(${[...selected]}::uuid[])`;
    if (penalty > 0n) {
      const key = `cancel-penalty:${[...selected].sort().join(',')}`;
      await tx.$executeRaw`
        INSERT INTO booking_charges(booking_id, kind, source_key, amount, reason, created_at, updated_at)
        VALUES(${bookingId}::uuid, 'PENALTY', ${key}, ${penalty}, 'Phụ thu đêm đầu khi khách không đến',
               ${now}, ${now})`;
      // `CASH` bắt buộc `created_by` (ck_payments_cash_shift) mà worker không có người dùng ⇒
      // ghi công nợ PENDING với hình thức chuyển khoản, chưa thu tiền.
      await tx.$executeRaw`
        INSERT INTO payments(booking_id, type, method, amount, status, idempotency_key, note,
                             created_at, updated_at)
        VALUES(${bookingId}::uuid, 'PENALTY', 'BANK_TRANSFER', ${penalty}, 'PENDING', ${key},
               'Phụ thu đêm đầu do job no-show ghi (BR-CANCEL-06)', ${now}, ${now})`;
    }

    // 5. Chiếu `bookings` (cùng định nghĩa với `BookingLedger`, ROOM coi như 0 khi NO_SHOW) + history.
    const totals = (
      await tx.$queryRaw<
        { room_total: bigint; penalty_total: bigint; paid: bigint; outstanding: bigint }[]
      >`
        SELECT
          (SELECT coalesce(sum(amount - voided_amount), 0) FROM booking_charges
            WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM')::bigint AS room_total,
          (SELECT coalesce(sum(amount - voided_amount), 0) FROM booking_charges
            WHERE booking_id = ${bookingId}::uuid AND kind = 'PENALTY')::bigint AS penalty_total,
          (SELECT coalesce(sum(amount), 0) FROM payments
            WHERE booking_id = ${bookingId}::uuid AND status = 'SUCCEEDED'
              AND type IN ('DEPOSIT', 'BALANCE', 'PENALTY', 'EXTRA_SERVICE', 'RESCHEDULE_FEE')
          )::bigint AS paid,
          (SELECT coalesce(sum(c.amount - c.voided_amount - coalesce(applied.amount, 0)), 0)
             FROM booking_charges c
             LEFT JOIN (SELECT charge_id, sum(amount - released_amount) AS amount
                          FROM payment_allocations GROUP BY charge_id) applied
               ON applied.charge_id = c.id
            WHERE c.booking_id = ${bookingId}::uuid AND c.kind <> 'ROOM'
          )::bigint AS outstanding`
    )[0]!;
    await tx.$executeRaw`
      UPDATE bookings
         SET status = 'NO_SHOW', total_amount = ${totals.room_total},
             penalty_amount = ${totals.penalty_total}, paid_amount = ${totals.paid},
             balance_due = ${totals.outstanding}, updated_at = ${now},
             version = version + 1
       WHERE id = ${bookingId}::uuid`;
    await tx.booking_status_history.create({
      data: {
        booking_id: bookingId,
        from_status: booking.status,
        to_status: 'NO_SHOW',
        reason: NO_SHOW_REASON,
        actor_id: null,
        at: now,
      },
    });
    // 6. Audit hệ thống + outbox tồn kho (chain_seq/row_hash do trigger CSDL cấp).
    await tx.$executeRaw`
      INSERT INTO audit_logs(chain_seq, actor_id, actor_role, action, entity_type, entity_id,
                             before_json, after_json, reason, row_hash, at)
      VALUES (0, null, 'SYSTEM', ${NO_SHOW_ACTION}, 'Booking', ${bookingId}::uuid,
              ${JSON.stringify({ status: booking.status })}::jsonb,
              ${JSON.stringify({
                status: 'NO_SHOW',
                releasedAssignments: assignments.length,
                penaltyAmount: penalty.toString(),
              })}::jsonb,
              ${NO_SHOW_REASON}, 'pending-database-trigger', ${now})`;
    await tx.outbox_events.create({
      data: {
        event_type: NO_SHOW_EVENT,
        aggregate_type: 'Booking',
        aggregate_id: bookingId,
        payload_json: {
          propertyId: booking.property_id,
          roomTypeId: booking.room_type_id,
          startDate: checkIn,
          endDate: booking.check_out.toISOString().slice(0, 10),
          roomIds: assignments.map((row) => row.room_id),
          operation: NO_SHOW_REASON,
        },
      },
    });
    return {
      marked: true,
      fromStatus: booking.status,
      releasedAssignments: assignments.length,
      penaltyAmount: penalty,
    };
  });
}

/** Cổng CSDL của lượt quét — nhỏ để test được nhánh "một booking lỗi không chặn booking khác". */
export interface NoShowPort {
  dueIds(batchSize: number): Promise<string[]>;
  mark(bookingId: string): Promise<MarkOutcome>;
}

export function prismaNoShowPort(db: PrismaClient, markTime: string): NoShowPort {
  return {
    dueIds: (batchSize) => dueNoShowIds(db, { markTime, batchSize }),
    mark: (bookingId) => markNoShow(db, bookingId, markTime),
  };
}

/** Một lượt quét: đọc trang ứng viên rồi xử lý từng booking trong transaction riêng. */
export async function sweepNoShows(
  port: NoShowPort,
  options: MarkOptions,
  log: JobContext['log'],
): Promise<MarkReport> {
  let scanned = 0;
  let marked = 0;
  let skipped = 0;
  let failed = 0;
  let releasedAssignments = 0;
  let penaltyTotal = 0n;
  let pages = 0;
  const attempted = new Set<string>();
  for (let page = 0; page < options.maxPages; page += 1) {
    const ids = await port.dueIds(options.batchSize);
    // Trang chỉ gồm booking đã thử (đang lỗi/khoá) ⇒ dừng, lượt sau nhặt lại.
    const fresh = ids.filter((id) => !attempted.has(id));
    if (fresh.length === 0) break;
    pages += 1;
    scanned += fresh.length;
    for (const id of fresh) {
      attempted.add(id);
      try {
        const outcome = await port.mark(id);
        if (!outcome.marked) {
          skipped += 1;
          continue;
        }
        marked += 1;
        releasedAssignments += outcome.releasedAssignments;
        penaltyTotal += outcome.penaltyAmount;
      } catch (error) {
        failed += 1;
        const errorCode =
          error instanceof Error && /^NO_SHOW_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'UNKNOWN';
        log({
          queue: NO_SHOW_QUEUE,
          msg: `no-show lỗi một booking (mã ${errorCode}); lượt sau quét lại`,
          errorCode,
        });
      }
    }
    if (ids.length < options.batchSize) break;
  }
  return { scanned, marked, skipped, failed, releasedAssignments, penaltyTotal, pages };
}
