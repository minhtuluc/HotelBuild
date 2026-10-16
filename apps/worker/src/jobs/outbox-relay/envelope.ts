import { z } from 'zod';

/**
 * Bao hình sự kiện **đi ra** của outbox (ADR-017 quyết định 8): `eventId`, `schemaVersion`, `aggregateId`,
 * `aggregateVersion`, `occurredAt`, `correlationId`, `causationId`.
 *
 * Relay dựng bao hình **từ hàng `outbox_events` đã commit**, không sửa producer và không tự sinh giá trị:
 * `eventId` = `id`, `occurredAt` = `created_at`, `aggregateId` = `aggregate_id`; phần do producer ghi trong
 * `payload_json` (`version` của `bigint` đi qua JSON thành chuỗi, một số producer chưa ghi `schemaVersion`)
 * được **parse phòng thủ một lần tại biên** bằng zod dưới đây: trường thiếu/sai chỉ mất chính nó (về `null`)
 * chứ không làm hỏng cả payload, và relay không đoán giá trị thay producer.
 */
export interface OutboxEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** `null` khi producer không ghi version — consumer phải tự quyết định có nhận hay không. */
  readonly aggregateVersion: number | null;
  readonly occurredAt: Date;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly channelId: string | null;
  /** Payload gốc đã commit; relay không sửa, không log nội dung này (NFR-SEC-04). */
  readonly payload: unknown;
}

/** Cột `outbox_events` mà relay cần để dựng bao hình (khớp truy vấn trong `relay.ts`). */
export interface OutboxEventRow {
  readonly id: string;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly channel_id: string | null;
  readonly payload_json: unknown;
  readonly created_at: Date;
}

export const OUTBOX_ENVELOPE_DEFAULT_SCHEMA_VERSION = 1;

/**
 * Số nguyên không âm và an toàn; nhận cả chuỗi số vì `version` của `bigint` đi qua JSON thành chuỗi.
 * `null` = producer không ghi hoặc ghi giá trị không dùng được (không làm tròn, không kẹp).
 */
const envelopeVersion = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .refine((value) => Number.isSafeInteger(value) && value >= 0)
  .nullable()
  .catch(null);

/** Trường bao hình trong `payload_json`; khoá lạ của producer vẫn nằm nguyên trong `payload`. */
const envelopeFields = z.looseObject({
  schemaVersion: z.number().int().min(1).nullable().catch(null),
  version: envelopeVersion,
  aggregateVersion: envelopeVersion,
  correlationId: z
    .string()
    .refine((value) => value.trim() !== '')
    .nullable()
    .catch(null),
  causationId: z
    .string()
    .refine((value) => value.trim() !== '')
    .nullable()
    .catch(null),
});

export function envelopeOf(row: OutboxEventRow): OutboxEnvelope {
  const parsed = envelopeFields.safeParse(row.payload_json);
  // `payload_json` không phải object (producer ghi sai) ⇒ coi như mọi trường bao hình đều vắng.
  const fields = parsed.success
    ? parsed.data
    : {
        schemaVersion: null,
        version: null,
        aggregateVersion: null,
        correlationId: null,
        causationId: null,
      };
  return {
    eventId: row.id,
    eventType: row.event_type,
    schemaVersion: fields.schemaVersion ?? OUTBOX_ENVELOPE_DEFAULT_SCHEMA_VERSION,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: fields.version ?? fields.aggregateVersion,
    occurredAt: row.created_at,
    correlationId: fields.correlationId,
    causationId: fields.causationId,
    channelId: row.channel_id,
    payload: row.payload_json,
  };
}
