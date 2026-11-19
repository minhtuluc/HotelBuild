/**
 * HB-266 — bảng giá theo đêm của đơn (SCR-80, BR-RATE-16): `GET /bookings/{id}/nights` trả giá đã chốt của
 * snapshot mới nhất. Số tiền nguyên văn máy chủ; app không cộng lại hay suy giá.
 */
import type { ApiClient } from '@pinehill/api-client';
import { bookingPriceSnapshotSchema, type BookingPriceSnapshot } from '@pinehill/contracts';

export interface NightLine {
  readonly key: string;
  readonly date: string;
  readonly amount: number;
  readonly roomCount: number;
}

export function nightLines(nights: BookingPriceSnapshot['nights']): readonly NightLine[] {
  return nights.map((night) => {
    const [year, month, day] = night.date.split('-');
    return {
      key: night.date,
      date: `${day}/${month}/${year}`,
      amount: night.amount,
      roomCount: night.roomCount,
    };
  });
}

/** Lỗi (offline, mất phiên…) ⇒ `null`: màn chi tiết vẫn hiện, chỉ khối giá theo đêm báo chưa xem được. */
export async function loadNights(
  read: () => Promise<BookingPriceSnapshot>,
): Promise<BookingPriceSnapshot | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export function nightsReader(
  client: ApiClient,
  bookingId: string,
): () => Promise<BookingPriceSnapshot> {
  return async () =>
    (
      await client.request({
        method: 'GET',
        path: `/bookings/${encodeURIComponent(bookingId)}/nights`,
        decoder: bookingPriceSnapshotSchema,
      })
    ).data;
}
