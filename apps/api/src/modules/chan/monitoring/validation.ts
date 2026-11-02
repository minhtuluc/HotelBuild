import { z } from 'zod';
import { invalid, missing } from '../../sys/settings/validation.js';

export const deliveryStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'DEAD_LETTER'] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];

const deliveryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  status: z.enum(deliveryStatuses).optional(),
  consumerKey: z.string().trim().min(1).max(64).optional(),
});

export interface DeliveryQuery {
  readonly limit: number;
  readonly cursor: string | null;
  readonly status: DeliveryStatus | null;
  readonly consumerKey: string | null;
}

export function deliveryQuery(value: unknown): DeliveryQuery {
  const parsed = deliveryQuerySchema.safeParse(value ?? {});
  if (!parsed.success) throw invalid();
  return {
    limit: parsed.data.limit,
    cursor: parsed.data.cursor ?? null,
    status: parsed.data.status ?? null,
    consumerKey: parsed.data.consumerKey ?? null,
  };
}

/** `deliveryId` sai định dạng là "không tìm thấy" (404) — cùng quy ước với `channelId`. */
export function deliveryIdParam(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw missing();
  return parsed.data.toLowerCase();
}

/**
 * Con trỏ keyset của danh sách delivery: `(created_at, event_id)` với `created_at` giữ **micro giây**
 * (`to_char` 6 chữ số) để so `timestamptz` chính xác, không mất dòng trong cùng một mili giây.
 */
export interface DeliveryCursor {
  readonly createdAt: string;
  readonly eventId: string;
}

const cursorPattern = /^[A-Za-z0-9_-]{16,400}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const cursorPayloadSchema = z.tuple([z.string().regex(timestampPattern), z.uuid()]);

export function encodeDeliveryCursor(cursor: DeliveryCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.eventId]), 'utf8').toString(
    'base64url',
  );
}

export function decodeDeliveryCursor(value: string): DeliveryCursor {
  if (!cursorPattern.test(value)) throw invalid();
  const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  const parsed = cursorPayloadSchema.safeParse(decoded);
  if (!parsed.success) throw invalid();
  const [createdAt, eventId] = parsed.data;
  return { createdAt, eventId: eventId.toLowerCase() };
}
