/**
 * Thứ tự bản tin OTA (AC7/AC8/AC9) — không dựa vào Redis, không dựa vào retention 7 ngày của inbox.
 *
 * - **Watermark** `channel_sync_watermarks` (khoá `channel_id + account_key`) tiến đơn điệu: `GREATEST`
 *   ở SQL để trigger DDL không thấy giá trị lùi.
 * - **Tombstone** `channel_cancel_tombstones` (khoá `channel_id + account_key + provider_booking_code`)
 *   là dấu huỷ bền: create/modify đến trước hay sau đều không hồi sinh booking (AC9).
 * - **Thứ tự theo booking** đọc `providerUpdatedAt`/`payloadHash` của snapshot mới nhất — bản ghi bất
 *   biến đã commit cùng booking, nên hai lần áp cạnh tranh không thể cùng thấy trạng thái cũ (AC7).
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { OTA_CODE } from './codes.js';

type Tx = Prisma.TransactionClient;

const snapshotIdentity = z.object({
  providerUpdatedAt: z.string().min(1),
  payloadHash: z.string().min(1).optional(),
});

export interface BookingState {
  readonly id: string;
  readonly status: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly roomCount: number;
  readonly channelPolicyCode: string | null;
  /** Sự kiện đã áp gần nhất (từ snapshot mới nhất); `null` khi booking không do OTA tạo. */
  readonly lastUpdatedAt: string | null;
  readonly lastPayloadHash: string | null;
}

export interface BookingRow {
  readonly id: string;
  readonly status: string;
  readonly check_in: string;
  readonly check_out: string;
  readonly room_count: number;
  readonly channel_policy_code: string | null;
}

/** Khoá hàng booking theo khoá tự nhiên rồi đọc trạng thái + sự kiện đã áp gần nhất. */
export async function lockBookingByRef(
  tx: Tx,
  channelId: string,
  externalRef: string,
): Promise<BookingState | null> {
  const rows = await tx.$queryRaw<BookingRow[]>`
    SELECT id, status,
           to_char(check_in, 'YYYY-MM-DD') AS check_in,
           to_char(check_out, 'YYYY-MM-DD') AS check_out,
           room_count, channel_policy_code
      FROM bookings
     WHERE channel_id = ${channelId}::uuid AND external_ref = ${externalRef}
     ORDER BY created_at, id
     LIMIT 1
     FOR UPDATE`;
  const booking = rows[0];
  if (booking === undefined) return null;
  const snapshot = await tx.price_snapshots.findFirst({
    where: { booking_id: booking.id },
    orderBy: { seq: 'desc' },
    select: { payload_json: true },
  });
  const parsed = snapshotIdentity.safeParse(snapshot?.payload_json);
  return {
    id: booking.id,
    status: booking.status,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    roomCount: booking.room_count,
    channelPolicyCode: booking.channel_policy_code,
    lastUpdatedAt: parsed.success ? parsed.data.providerUpdatedAt : null,
    lastPayloadHash: parsed.success ? (parsed.data.payloadHash ?? null) : null,
  };
}

export interface TombstoneKey {
  readonly channelId: string;
  readonly accountKey: string;
  readonly providerBookingCode: string;
}

export async function findTombstone(
  tx: Tx,
  key: TombstoneKey,
): Promise<{ readonly providerUpdatedAt: Date } | null> {
  const rows = await tx.$queryRaw<
    { provider_updated_at: Date }[]
  >`SELECT provider_updated_at FROM channel_cancel_tombstones
      WHERE channel_id = ${key.channelId}::uuid
        AND account_key = ${key.accountKey}
        AND provider_booking_code = ${key.providerBookingCode}
      FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : { providerUpdatedAt: row.provider_updated_at };
}

export interface TombstoneWrite extends TombstoneKey {
  readonly providerUpdatedAt: Date;
  readonly cancelledAt: Date;
  readonly bookingId: string | null;
  readonly now: Date;
}

export async function writeTombstone(tx: Tx, input: TombstoneWrite): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO channel_cancel_tombstones(
      channel_id, account_key, provider_booking_code, provider_updated_at,
      cancelled_at, cancel_reason, booking_id, created_at, updated_at)
    VALUES (${input.channelId}::uuid, ${input.accountKey}, ${input.providerBookingCode},
            ${input.providerUpdatedAt}, ${input.cancelledAt}, 'OTA_CANCELLATION',
            ${input.bookingId}::uuid, ${input.now}, ${input.now})
    ON CONFLICT (channel_id, account_key, provider_booking_code) DO UPDATE
      SET provider_updated_at =
            GREATEST(channel_cancel_tombstones.provider_updated_at, EXCLUDED.provider_updated_at),
          cancelled_at = LEAST(channel_cancel_tombstones.cancelled_at, EXCLUDED.cancelled_at),
          booking_id = COALESCE(channel_cancel_tombstones.booking_id, EXCLUDED.booking_id),
          updated_at = EXCLUDED.updated_at`;
}

export interface WatermarkWrite {
  readonly channelId: string;
  readonly accountKey: string;
  readonly provider: string;
  readonly watermarkAt: Date;
  readonly eventId: string;
  readonly now: Date;
}

/** `GREATEST` để trigger đơn điệu của DDL không thấy bước lùi (kể cả khi phát lại sự kiện cũ hơn). */
export async function advanceWatermark(tx: Tx, input: WatermarkWrite): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO channel_sync_watermarks(
      channel_id, account_key, provider, watermark_at, last_event_id,
      last_success_at, created_at, updated_at)
    VALUES (${input.channelId}::uuid, ${input.accountKey}, ${input.provider},
            ${input.watermarkAt}, ${input.eventId}, ${input.now}, ${input.now}, ${input.now})
    ON CONFLICT (channel_id, account_key) DO UPDATE
      SET watermark_at = GREATEST(channel_sync_watermarks.watermark_at, EXCLUDED.watermark_at),
          last_event_id = CASE
            WHEN EXCLUDED.watermark_at >= channel_sync_watermarks.watermark_at
              THEN EXCLUDED.last_event_id
            ELSE channel_sync_watermarks.last_event_id END,
          last_success_at = EXCLUDED.last_success_at,
          updated_at = EXCLUDED.updated_at`;
}

export type OrderDecision =
  | { readonly kind: 'apply' }
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'conflict'; readonly reason: string };

export interface OrderEvent {
  readonly type: 'booking.created' | 'booking.modified' | 'booking.cancelled';
  readonly updatedAt: string;
  readonly payloadHash: string;
}

/**
 * `booking.cancelled` **thắng** modify bất kể thứ tự nhận (AC8) nên không so mốc. Với create/modify:
 * mốc mới hơn ⇒ áp; cũ hơn ⇒ bỏ (sự kiện cũ không ghi đè); bằng nhau cùng hash ⇒ bỏ (phát lại); bằng
 * nhau khác hash ⇒ cách ly đối soát (AC7).
 */
export function decideOrder(event: OrderEvent, booking: BookingState): OrderDecision {
  if (event.type === 'booking.cancelled') return { kind: 'apply' };
  if (booking.status === 'CANCELLED')
    return event.type === 'booking.created'
      ? { kind: 'conflict', reason: OTA_CODE.resurrection }
      : { kind: 'skip', reason: OTA_CODE.cancellationWins };
  if (booking.lastUpdatedAt === null) return { kind: 'apply' };
  const incoming = Date.parse(event.updatedAt);
  const applied = Date.parse(booking.lastUpdatedAt);
  if (incoming > applied) return { kind: 'apply' };
  if (incoming < applied) return { kind: 'skip', reason: OTA_CODE.staleEvent };
  return event.payloadHash === booking.lastPayloadHash
    ? { kind: 'skip', reason: OTA_CODE.staleEvent }
    : { kind: 'conflict', reason: OTA_CODE.orderConflict };
}
