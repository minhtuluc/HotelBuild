/**
 * Truy vấn/khẳng định dùng chung cho oracle HB-129 (giai đoạn A).
 *
 * Chỉ đọc bảng thật; không mock tầng nào. Tách khỏi `fixture.ts` để mỗi tệp dưới giới hạn `max-lines`
 * của lint và để ba spec dùng đúng một cách đọc CSDL.
 */
import { z } from 'zod';
import { rows } from '../room-blocks/inventory-seed.js';

/** SĐT tổng hợp của payload — dùng để chứng minh log/audit không rò PII. */
export const GUEST_PHONE = '0900000129';

export function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error(`HB129 expected text-like, got ${typeof value}`);
}

/** `int8` của `pg` về `string`; `int2/int4` về `number` — một chỗ đổi để assertion không vỡ. */
export function count(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error(`HB129 expected integer-like, got ${String(value)}`);
}

/**
 * Ngày nghiệp vụ của cột `date`: node-postgres trả `Date` ở **nửa đêm giờ địa phương**, nên
 * `toISOString()` trên máy +07 lùi một ngày. Đọc thành phần lịch địa phương thay vì UTC.
 */
export function dayOf(value: unknown): string {
  if (value instanceof Date) {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'string') return value.slice(0, 10);
  throw new Error(`HB129 expected date-like, got ${String(value)}`);
}

export function instantOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  throw new Error(`HB129 expected timestamp-like, got ${String(value)}`);
}

/** Bản ghi duy nhất mong đợi: ném lỗi rõ thay vì `undefined` rải xuống assertion. */
export function one(list: readonly Record<string, unknown>[]): Record<string, unknown> {
  const [row] = list;
  if (row === undefined) throw new Error('HB129 expected exactly one row');
  return row;
}

export const bookingOf = (ref: string) =>
  rows('SELECT * FROM bookings WHERE external_ref=$1 ORDER BY created_at, id', [ref]);
export const bookingById = (id: string) => rows('SELECT * FROM bookings WHERE id=$1', [id]);
export const paymentsOf = (bookingId: string) =>
  rows('SELECT * FROM payments WHERE booking_id=$1 ORDER BY created_at, id', [bookingId]);
export const snapshotsOf = (bookingId: string) =>
  rows('SELECT * FROM price_snapshots WHERE booking_id=$1 ORDER BY seq', [bookingId]);
export const chargesOf = (bookingId: string) =>
  rows('SELECT * FROM booking_charges WHERE booking_id=$1 ORDER BY source_key', [bookingId]);
export const roomsOf = (bookingId: string) =>
  rows('SELECT * FROM booking_rooms WHERE booking_id=$1 ORDER BY created_at, id', [bookingId]);
export const assignmentsOf = (bookingId: string) =>
  rows(
    `SELECT ra.* FROM room_assignments ra JOIN booking_rooms br ON br.id=ra.booking_room_id
     WHERE br.booking_id=$1 ORDER BY ra.start_date, ra.bed_no, ra.id`,
    [bookingId],
  );
export const inboxOf = (id: string) =>
  rows('SELECT * FROM webhook_inbox WHERE event_id=$1 ORDER BY created_at', [id]);
export const tombstonesOf = (code: string) =>
  rows('SELECT * FROM channel_cancel_tombstones WHERE provider_booking_code=$1', [code]);
export const watermarkOf = (channelId: string, accountKey: string) =>
  rows('SELECT * FROM channel_sync_watermarks WHERE channel_id=$1 AND account_key=$2', [
    channelId,
    accountKey,
  ]);
export const allotmentOf = (channelId: string, roomTypeId: string, date: string) =>
  rows('SELECT * FROM channel_allotments WHERE channel_id=$1 AND room_type_id=$2 AND date=$3', [
    channelId,
    roomTypeId,
    date,
  ]);
export const auditOf = (entityId: string) =>
  rows('SELECT * FROM audit_logs WHERE entity_id=$1::uuid ORDER BY at, id', [entityId]);
export const casesOf = (roomTypeId: string) =>
  rows('SELECT * FROM overbooking_cases WHERE room_type_id=$1 ORDER BY date, id', [roomTypeId]);
export const refundsOf = (bookingId: string) =>
  rows('SELECT * FROM refund_requests WHERE booking_id=$1', [bookingId]);

export async function countBookings(channelId: string): Promise<number> {
  return count(
    one(await rows('SELECT count(*) AS n FROM bookings WHERE channel_id=$1', [channelId])).n,
  );
}

/** Trạng thái "cách ly" bền: inbox `DEAD_LETTER` + dấu đối soát SYSTEM, không PII (AC11). */
export async function expectQuarantinedInbox(id: string): Promise<void> {
  const inbox = one(await inboxOf(id));
  if (typeof inbox.status !== 'string' || inbox.status !== 'DEAD_LETTER')
    throw new Error(`HB129 ${id} expected DEAD_LETTER, got ${String(inbox.status)}`);
  if (typeof inbox.last_error !== 'string' || !/^[A-Z][A-Z0-9_]{2,60}$/.test(inbox.last_error))
    throw new Error(`HB129 ${id} last_error must be a short code, got ${String(inbox.last_error)}`);
  const trail = await rows(
    'SELECT actor_role, actor_id, after_json, reason FROM audit_logs WHERE entity_id=$1::uuid',
    [inbox.id],
  );
  if (trail.length === 0) throw new Error(`HB129 ${id} has no reconciliation audit row`);
  if (!trail.every((row) => text(row.actor_role) === 'SYSTEM' && row.actor_id === null))
    throw new Error(`HB129 ${id} reconciliation must use the SYSTEM service principal`);
  if (JSON.stringify(trail).includes(GUEST_PHONE))
    throw new Error(`HB129 ${id} reconciliation trail leaks guest PII`);
}

const snapshotPayloadSchema = z.object({
  payload_json: z.object({ nights: z.array(z.unknown()).min(1) }),
});

function expectCollectBookingRow(
  booking: Record<string, unknown>,
  channelId: string,
  total: number,
): void {
  if (text(booking.status) !== 'CONFIRMED') throw new Error('HB129 OTA booking must be CONFIRMED');
  if (text(booking.channel_id) !== channelId) throw new Error('HB129 OTA booking channel mismatch');
  if (!/^PH-\d{6}-[A-Z0-9]{5}$/.test(text(booking.code)))
    throw new Error('HB129 booking code must follow PH-YYMMDD-XXXXX');
  if (count(booking.total_amount) !== total) throw new Error('HB129 total_amount mismatch');
  if (count(booking.paid_amount) !== total) throw new Error('HB129 paid_amount mismatch');
  if (count(booking.balance_due) !== 0) throw new Error('HB129 balance_due must be zero');
  if (booking.oversold !== false) throw new Error('HB129 booking must not be oversold');
  if (booking.hold_expires_at !== null) throw new Error('HB129 OTA booking must not hold');
  if (booking.cancelled_at !== null)
    throw new Error('HB129 fresh OTA booking must not be cancelled');
}

function expectCollectSnapshot(snapshot: Record<string, unknown>, total: number): void {
  if (text(snapshot.kind) !== 'ORIGINAL') throw new Error('HB129 snapshot must be ORIGINAL');
  if (count(snapshot.gross_amount) !== total) throw new Error('HB129 snapshot gross mismatch');
  snapshotPayloadSchema.parse(snapshot);
}

function expectCollectPayment(payment: Record<string, unknown>, total: number): void {
  if (text(payment.method) !== 'OTA_COLLECT') throw new Error('HB129 payment must be OTA_COLLECT');
  if (text(payment.status) !== 'SUCCEEDED')
    throw new Error('HB129 OTA collection must be SUCCEEDED');
  if (count(payment.amount) !== total) throw new Error('HB129 payment amount mismatch');
  if (payment.paid_at === null) throw new Error('HB129 OTA collection must be paid');
}

function expectCollectCharges(charges: readonly Record<string, unknown>[], total: number): void {
  if (!charges.every((row) => text(row.kind) === 'ROOM'))
    throw new Error('HB129 OTA booking must only charge ROOM');
  const chargeTotal = charges.reduce((sum, row) => sum + count(row.amount), 0);
  if (chargeTotal !== total) throw new Error('HB129 ROOM obligation total mismatch');
}

/** AC1: booking OTA thu hộ tạo thẳng `CONFIRMED` + BookingRoom/PriceSnapshot + sổ cái `OTA_COLLECT`. */
export async function expectOtaCollect(
  bookingId: string,
  channelId: string,
  total: number,
): Promise<void> {
  expectCollectBookingRow(one(await bookingById(bookingId)), channelId, total);
  if ((await roomsOf(bookingId)).length === 0) throw new Error('HB129 booking has no BookingRoom');

  expectCollectSnapshot(one(await snapshotsOf(bookingId)), total);

  const payments = await paymentsOf(bookingId);
  expectCollectPayment(one(payments), total);
  if (payments.some((row) => text(row.type) === 'REFUND'))
    throw new Error('HB129 OTA collection must not be a refund');

  expectCollectCharges(await chargesOf(bookingId), total);

  const allocated = one(
    await rows(
      `SELECT COALESCE(SUM(pa.amount),0) AS total FROM payment_allocations pa
         JOIN payments p ON p.id=pa.payment_id WHERE p.booking_id=$1`,
      [bookingId],
    ),
  );
  if (count(allocated.total) !== total) throw new Error('HB129 ledger allocation mismatch');
}

/** Công cụ ca lỗi ghi **thật**: đổi tên bảng bằng vai sở hữu rồi đổi lại (mẫu HB-128 `fault.ts`). */
export class TableOutage {
  private constructor(
    private readonly table: string,
    private readonly label: string,
  ) {}

  static async start(table: string, label: string): Promise<TableOutage> {
    await rows(`ALTER TABLE ${table} RENAME TO ${table}_${label}`);
    return new TableOutage(table, label);
  }

  async restore(): Promise<void> {
    await rows(`ALTER TABLE ${this.table}_${this.label} RENAME TO ${this.table}`);
  }
}
