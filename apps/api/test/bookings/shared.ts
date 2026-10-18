/**
 * Khẳng định dùng chung của ba ca tích hợp HB-077 (`create`, `confirm`, `reads`):
 * đọc hàng `bookings` + `price_snapshots` từ CSDL và parse zod (QT §2: không `as`).
 */
import { z } from 'zod';
import { errorBodySchema } from '@pinehill/contracts';
import { rowsOf } from './fixture.js';

export const codeOf = (body: unknown): string => errorBodySchema.parse(body).code;

/** Hình dạng `payload_json` mà HB-097 (`snapshotPayloadSchema`) và báo cáo doanh thu đọc lại. */
export const snapshotPayloadSchema = z.object({
  schemaVersion: z.number().int().positive(),
  engineVersion: z.string().min(1),
  quoteId: z.string().min(1),
  quoteFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  stay: z.object({
    checkIn: z.string().min(1),
    checkOut: z.string().min(1),
    timezone: z.string().min(1),
    checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    checkOutTime: z.string().min(1),
  }),
  nights: z.array(
    z.object({
      bookingRoomId: z.string().min(1),
      date: z.string().min(1),
      grossAmount: z.number().int().nonnegative(),
      commissionAmount: z.number().int().nonnegative(),
      nightlyPrice: z.number().int().positive(),
    }),
  ),
  totals: z.object({
    subtotal: z.number().int().nonnegative(),
    discountAmount: z.number().int().nonnegative(),
    grossAmount: z.number().int().nonnegative(),
    commissionAmount: z.number().int().nonnegative(),
    depositAmount: z.number().int().nonnegative(),
    currency: z.literal('VND'),
  }),
});

export const policySnapshotSchema = z.object({
  id: z.string().min(1),
  tiers: z
    .array(
      z.object({
        id: z.string().min(1),
        offsetHours: z.number().int(),
        refundPercent: z.number().int(),
        chargeFirstNight: z.boolean(),
      }),
    )
    .min(1),
});

export const snapshotRowSchema = z.object({
  id: z.string(),
  seq: z.number(),
  kind: z.string(),
  quote_id: z.string(),
  quote_fingerprint: z.string(),
  engine_version: z.string(),
  gross_amount: z.string(),
  commission_amount: z.string(),
  channel_property_setting_id: z.string().nullable(),
  payload_json: snapshotPayloadSchema,
  policy_snapshot_json: policySnapshotSchema,
});

const bookingRowSchema = z.object({
  status: z.string(),
  total_amount: z.string(),
  deposit_amount: z.string(),
  balance_due: z.string(),
  paid_amount: z.string(),
  room_count: z.number(),
  version: z.string(),
  created_by: z.string().nullable(),
  hold_expires_at: z.date().nullable(),
  duplicate_suspected: z.boolean(),
  seconds_left: z.number(),
});

export type BookingRow = z.infer<typeof bookingRowSchema>;

export async function bookingRow(id: string): Promise<BookingRow> {
  return (
    await rowsOf(
      `SELECT status, total_amount, deposit_amount, balance_due, paid_amount, room_count,
              version, created_by, hold_expires_at, duplicate_suspected,
              extract(epoch FROM (hold_expires_at - clock_timestamp()))::float8 AS seconds_left
         FROM bookings WHERE id=$1`,
      bookingRowSchema,
      [id],
    )
  )[0]!;
}
