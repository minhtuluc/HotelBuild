/**
 * Hết hạn giữ chỗ (HB-078) — lõi của job `q.hold-expiry`: `bookings` đang ở `HELD`/`PENDING_PAYMENT` và
 * `hold_expires_at <= now()` (giờ CSDL) chuyển `EXPIRED` và **nhả tồn trong cùng transaction**
 * (BR-BOOK-08, BR-INV-04, BR-BOOK-18; ADR-014; csdl §3.2.4).
 *
 * Vì sao đường này không đọc Redis: `bookings.hold_expires_at` là **nguồn chân lý** của hạn giữ chỗ, Redis
 * (`hold:<bookingId>`) chỉ là bộ đếm nhanh (csdl §3, ADR-014). Mất Redis không ngăn hạn được giải phóng —
 * job `hold-reconcile` 900 giây sửa lại projection sau (`projection.ts`).
 *
 * Khoá và thời gian, theo đúng thứ tự ADR-014 và BR-BOOK-18:
 * 1. `bookings` (chính booking) `FOR UPDATE` — **không** `SKIP LOCKED`: chờ transaction đang giữ khoá
 *    (callback thanh toán/xác nhận) rồi **đọc lại** trạng thái và hạn bằng `clock_timestamp()`. Ai thắng
 *    khoá trước thì người đó quyết định; bên thua thấy trạng thái mới và bỏ qua ⇒ booking không hồi sinh.
 * 2. `properties` → `room_types` → các `rooms` đang gán (`ORDER BY id`) rồi mới ghi — cùng thứ tự với
 *    đường giữ chỗ/huỷ nên không tạo chu trình khoá.
 * 3. Ghi nguyên tử: nhả mọi `room_assignments` còn hoạt động + booking → `EXPIRED` +
 *    `booking_status_history` + `audit_logs` (BR-GEN-07) + `outbox_events` + nhả `channel_allotments.used`.
 *
 * Danh sách ứng viên đọc bằng **một** câu `SELECT` không khoá (giờ CSDL); mỗi booking chạy trong
 * transaction riêng nên một booking hỏng không kéo cả lượt quét xuống (lượt sau nhặt lại).
 */
import type { PrismaClient } from '@prisma/client';
import { currentTraceFields } from '../../tracing/trace-context.js';
import type { JobContext } from '../types.js';

/** Hàng đợi khai ở `queues.ts`; chạy lặp theo `HOLD_EXPIRY_INTERVAL_SECONDS`. */
export const HOLD_QUEUE = 'q.hold-expiry';

/** BR-BOOK-06/07: hai trạng thái "đang chờ" chiếm tồn và luôn có `hold_expires_at`. */
export const HOLD_DUE_STATUSES = ['HELD', 'PENDING_PAYMENT'] as const;

/** Lý do ghi vào `room_assignments.release_reason` + `booking_status_history.reason` (cùng bộ mã với HB-076). */
export const HOLD_EXPIRED_REASON = 'HOLD_EXPIRED';

/** Hành động ghi nhật ký (`audit_logs.action`) — BR-GEN-07. */
export const HOLD_EXPIRED_ACTION = 'BOOKING_EXPIRED';

/** Loại sự kiện cổng ra trong transaction — cùng loại với đường giữ chỗ/nhả chỗ (HB-076). */
export const HOLD_EXPIRED_EVENT = 'InventoryChanged';

export interface SweepOptions {
  /** Số booking mỗi trang; trang nhỏ giữ lượt quét 30 giây ngắn khi tồn đọng lớn. */
  readonly batchSize: number;
  /** Trần số trang mỗi lượt (1 với nhịp 30 giây, nhiều hơn với lượt đối chiếu 900 giây). */
  readonly maxPages: number;
  /**
   * Quá hạn lâu hơn mốc này (giây) ⇒ lượt quét trước đã bỏ sót (NFR-REL-02: nhả trong 60 giây, tức hai
   * nhịp 30 giây). Chỉ là **bộ đếm quan sát** trong log, không đổi cách xử lý.
   */
  readonly missedGraceSeconds: number;
}

export interface SweepReport {
  /** Số booking đến hạn (theo giờ CSDL) đã đọc ở mọi trang. */
  readonly scanned: number;
  readonly expired: number;
  /** Đã hết đến hạn/hết trạng thái chờ khi đọc lại sau khoá (thua đua tranh, hoặc lượt trước vừa xử lý). */
  readonly skipped: number;
  /** Lỗi của **một** booking; lượt sau quét lại (không nuốt lỗi, chỉ không chặn các booking khác). */
  readonly failed: number;
  readonly releasedAssignments: number;
  readonly releasedAllotments: number;
  /** Số booking bị bỏ sót quá hạn SLA ở lượt này (0 là bình thường). */
  readonly missed: number;
  readonly pages: number;
}

interface HoldRow {
  readonly id: string;
  readonly property_id: string;
  readonly room_type_id: string;
  readonly channel_id: string;
  readonly check_in: Date;
  readonly check_out: Date;
  readonly room_count: number;
  readonly status: string;
  readonly hold_expires_at: Date | null;
}

interface AssignmentRow {
  readonly id: string;
  readonly room_id: string;
}

export interface ExpireOutcome {
  readonly expired: boolean;
  readonly releasedAssignments: number;
  readonly releasedAllotments: number;
  /** Số giây quá hạn tại thời điểm quyết định (giờ CSDL); 0 khi không xử lý. */
  readonly overdueSeconds: number;
  /** Trạng thái **trước** khi hết hạn (`HELD`/`PENDING_PAYMENT`), `null` khi bỏ qua. */
  readonly fromStatus: string | null;
}

const SKIPPED: ExpireOutcome = {
  expired: false,
  releasedAssignments: 0,
  releasedAllotments: 0,
  overdueSeconds: 0,
  fromStatus: null,
};

/**
 * Mã lỗi an toàn để log: chỉ nhận **mã** của lỗi CSDL/hạ tầng, không nhận message/stack (có thể mang
 * giá trị dữ liệu). Không có mã ⇒ `UNKNOWN`.
 */
export function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string' && /^[0-9A-Z_]{2,16}$/.test(code)) return code;
  }
  return 'UNKNOWN';
}

/** Đọc một trang booking **đến hạn theo giờ CSDL** (BR-BOOK-18) — không dùng đồng hồ tiến trình. */
export async function dueHoldIds(db: PrismaClient, batchSize: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM bookings
     WHERE status IN ('HELD', 'PENDING_PAYMENT')
       AND hold_expires_at <= clock_timestamp()
     ORDER BY hold_expires_at, seq
     LIMIT ${batchSize}`;
  return rows.map((row) => row.id);
}

/**
 * Hết hạn **một** booking trong một transaction. Trả `expired: false` khi booking đã đổi trạng thái hoặc
 * không còn quá hạn lúc đọc lại sau khoá (bên thắng đua tranh đã xử lý xong).
 */
export async function expireHold(db: PrismaClient, bookingId: string): Promise<ExpireOutcome> {
  return db.$transaction(async (tx) => {
    // 1. Khoá Booking trước (ADR-014). Chờ transaction đang giữ khoá rồi đọc lại trạng thái + hạn.
    const rows = await tx.$queryRaw<HoldRow[]>`
      SELECT id, property_id, room_type_id, channel_id, check_in, check_out, room_count, status,
             hold_expires_at
        FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    const booking = rows[0];
    if (booking === undefined) return SKIPPED;
    const [now] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    if (
      now === undefined ||
      !HOLD_DUE_STATUSES.some((status) => status === booking.status) ||
      booking.hold_expires_at === null ||
      booking.hold_expires_at.getTime() > now.now.getTime()
    ) {
      return SKIPPED;
    }
    // 2. properties → room_types → rooms đang gán (đúng thứ tự ADR-014).
    await tx.$queryRaw`SELECT id FROM properties WHERE id = ${booking.property_id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM room_types WHERE id = ${booking.room_type_id}::uuid FOR UPDATE`;
    const assignments = await tx.$queryRaw<AssignmentRow[]>`
      SELECT a.id, a.room_id FROM room_assignments a
        JOIN booking_rooms br ON br.id = a.booking_room_id
       WHERE br.booking_id = ${booking.id}::uuid AND a.released_at IS NULL
       ORDER BY a.id FOR UPDATE`;
    if (assignments.length > 0) {
      await tx.room_assignments.updateMany({
        where: { id: { in: assignments.map((row) => row.id) } },
        data: { released_at: now.now, release_reason: HOLD_EXPIRED_REASON, updated_at: now.now },
      });
    }
    // 3. Trạng thái kết thúc: EXPIRED không phải CANCELLED nên KHÔNG đặt `cancelled_at`/`cancel_reason`
    //    (`ck_bookings_cancelled` chỉ áp cho CANCELLED; `cancel_reason` để trống vì hết hạn không có phạt).
    await tx.bookings.update({
      where: { id: booking.id },
      data: { status: 'EXPIRED', updated_at: now.now, version: { increment: 1 } },
    });
    await tx.booking_status_history.create({
      data: {
        booking_id: booking.id,
        from_status: booking.status,
        to_status: 'EXPIRED',
        reason: HOLD_EXPIRED_REASON,
        actor_id: null,
        at: now.now,
      },
    });
    // BR-BOOK-18: nhả phần `channel_allotments.used` booking đang chiếm (mỗi đêm trong kỳ). Bảng này chỉ
    // bị trừ khi đã từng được tiêu (HB-131 đồng bộ kênh là bên cấp `used`) nên câu lệnh có điều kiện `used > 0`.
    const releasedAllotments = await tx.$executeRaw`
      UPDATE channel_allotments
         SET used = greatest(used - ${booking.room_count}, 0), updated_at = ${now.now}::timestamptz
       WHERE channel_id = ${booking.channel_id}::uuid
         AND room_type_id = ${booking.room_type_id}::uuid
         AND date >= ${booking.check_in}::date AND date < ${booking.check_out}::date
         AND used > 0`;
    // Audit hệ thống (HB-009 cùng hình dạng: chain_seq/row_hash do trigger cấp; actor_id null, role SYSTEM).
    await tx.$executeRaw`
      INSERT INTO audit_logs(chain_seq, actor_id, actor_role, action, entity_type, entity_id,
                             before_json, after_json, reason, row_hash, at)
      VALUES (0, null, 'SYSTEM', ${HOLD_EXPIRED_ACTION}, 'Booking', ${booking.id}::uuid,
              ${JSON.stringify({
                status: booking.status,
                holdExpiresAt: booking.hold_expires_at.toISOString(),
              })}::jsonb,
              ${JSON.stringify({
                status: 'EXPIRED',
                releasedAssignments: assignments.length,
                releasedAllotments,
              })}::jsonb,
              ${HOLD_EXPIRED_REASON}, 'pending-database-trigger', ${now.now}::timestamptz)`;
    // Client Prisma của worker không có extension trace của API ⇒ job tự mang ngữ cảnh trace của lượt
    // quét sang sự kiện, để relay/consumer nối tiếp đúng trace (HB-181 review P2).
    const trace = currentTraceFields();
    await tx.outbox_events.create({
      data: {
        event_type: HOLD_EXPIRED_EVENT,
        aggregate_type: 'Booking',
        aggregate_id: booking.id,
        payload_json: {
          propertyId: booking.property_id,
          roomTypeId: booking.room_type_id,
          startDate: booking.check_in.toISOString().slice(0, 10),
          endDate: booking.check_out.toISOString().slice(0, 10),
          roomIds: assignments.map((row) => row.room_id),
          operation: HOLD_EXPIRED_REASON,
          ...(trace === null
            ? {}
            : {
                traceparent: trace.traceparent,
                ...(trace.correlationId === null ? {} : { correlationId: trace.correlationId }),
              }),
        },
      },
    });
    return {
      expired: true,
      releasedAssignments: assignments.length,
      releasedAllotments,
      overdueSeconds: Math.floor((now.now.getTime() - booking.hold_expires_at.getTime()) / 1000),
      fromStatus: booking.status,
    };
  });
}

/**
 * Cổng CSDL của lượt quét: hai thao tác duy nhất nó cần. Cổng nhỏ để test được nhánh "một booking lỗi
 * không chặn các booking khác" mà không phải dựng CSDL hỏng, và để handler chỉ phụ thuộc hành vi.
 */
export interface HoldExpiryPort {
  /** Danh sách booking đến hạn (giờ CSDL). */
  dueIds(batchSize: number): Promise<string[]>;
  /** Hết hạn một booking trong một transaction riêng. */
  expire(bookingId: string): Promise<ExpireOutcome>;
}

/** Cổng thật trên Prisma của tiến trình worker. */
export function prismaHoldExpiryPort(db: PrismaClient): HoldExpiryPort {
  return {
    dueIds: (batchSize) => dueHoldIds(db, batchSize),
    expire: (bookingId) => expireHold(db, bookingId),
  };
}

/** Một lượt quét: đọc trang booking đến hạn rồi xử lý từng booking trong transaction riêng. */
export async function sweepDueHolds(
  port: HoldExpiryPort,
  options: SweepOptions,
  log: JobContext['log'],
): Promise<SweepReport> {
  let scanned = 0;
  let expired = 0;
  let skipped = 0;
  let failed = 0;
  let releasedAssignments = 0;
  let releasedAllotments = 0;
  let missed = 0;
  let pages = 0;
  const attempted = new Set<string>();
  for (let page = 0; page < options.maxPages; page += 1) {
    const ids = await port.dueIds(options.batchSize);
    // Trang rỗng, hoặc trang chỉ gồm booking đã thử ở trang trước (đang bị lỗi/khoá) ⇒ dừng, lượt sau nhặt lại.
    const fresh = ids.filter((id) => !attempted.has(id));
    if (fresh.length === 0) break;
    pages += 1;
    scanned += fresh.length;
    for (const id of fresh) {
      attempted.add(id);
      try {
        const outcome = await port.expire(id);
        if (!outcome.expired) {
          skipped += 1;
          continue;
        }
        expired += 1;
        releasedAssignments += outcome.releasedAssignments;
        releasedAllotments += outcome.releasedAllotments;
        if (outcome.overdueSeconds > options.missedGraceSeconds) missed += 1;
      } catch (error) {
        failed += 1;
        const errorCode = safeErrorCode(error);
        log({
          queue: HOLD_QUEUE,
          msg: `hết hạn hold lỗi một booking (mã ${errorCode}); lượt sau quét lại`,
          errorCode,
        });
      }
    }
    if (ids.length < options.batchSize) break;
  }
  return {
    scanned,
    expired,
    skipped,
    failed,
    releasedAssignments,
    releasedAllotments,
    missed,
    pages,
  };
}
