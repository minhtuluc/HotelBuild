import { createHash } from 'node:crypto';
import { z } from 'zod';
import { invalid } from '../../sys/settings/validation.js';
import { validDate } from '../../inv/allotments/validation.js';

/** Trần `q` và `status` giữ kích thước khoá cursor và truy vấn có biên. */
const querySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
  from: z.string().min(1).max(10).optional(),
  to: z.string().min(1).max(10).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export interface OtaQueueQuery {
  readonly from: string | null;
  readonly to: string | null;
  readonly status: string | null;
  readonly q: string | null;
  readonly limit: number;
  readonly cursor: string | null;
}

/** Ngày lọc tuỳ chọn: phải là ngày lịch thật, không nhận chuỗi rác. */
function dateBound(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!validDate(value)) throw invalid();
  return value;
}

export function queueQuery(value: unknown): OtaQueueQuery {
  const parsed = querySchema.safeParse(value ?? {});
  if (!parsed.success) throw invalid();
  const from = dateBound(parsed.data.from);
  const to = dateBound(parsed.data.to);
  if (from !== null && to !== null && to <= from) throw invalid();
  return {
    from,
    to,
    status: parsed.data.status ?? null,
    q: parsed.data.q ?? null,
    limit: parsed.data.limit,
    cursor: parsed.data.cursor ?? null,
  };
}

/**
 * Con trỏ keyset **gắn bộ lọc**: `filter` là vân tay của (kênh, from/to, status, q, scope cơ sở). Client
 * đổi bộ lọc mà giữ con trỏ cũ bị 400 thay vì lặng lẽ nhận trang khác nghĩa (api.md §1.4).
 */
export interface QueueCursor {
  readonly filter: string;
  readonly checkIn: string;
  readonly id: string;
}

const cursorPattern = /^[A-Za-z0-9_-]{16,400}$/;
const cursorPayloadSchema = z.tuple([
  z.string().min(1).max(64),
  z.string().refine(validDate),
  z.uuid(),
]);

export function filterFingerprint(parts: {
  readonly channelId: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly status: string | null;
  readonly q: string | null;
  readonly scope: readonly string[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        parts.channelId,
        parts.from,
        parts.to,
        parts.status,
        parts.q,
        [...parts.scope].sort(),
      ]),
    )
    .digest('base64url')
    .slice(0, 24);
}

export function encodeQueueCursor(cursor: QueueCursor): string {
  return Buffer.from(JSON.stringify([cursor.filter, cursor.checkIn, cursor.id]), 'utf8').toString(
    'base64url',
  );
}

export function decodeQueueCursor(value: string): QueueCursor {
  if (!cursorPattern.test(value)) throw invalid();
  const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  const parsed = cursorPayloadSchema.safeParse(decoded);
  if (!parsed.success) throw invalid();
  const [filter, checkIn, id] = parsed.data;
  return { filter, checkIn, id: id.toLowerCase() };
}
