import { cancelRequestSchema, rescheduleRequestSchema } from '@pinehill/contracts';
import type { KeyValueStorage } from '../storage';
import type { ChangeKind, ChangeIntent, IntentStore } from './types';

function recordOf(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('Invalid intent');
  return value;
}
function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error('Invalid intent field');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid intent timestamp');
  return value;
}
function parseIntent(raw: string, bookingId: string, kind: ChangeKind): ChangeIntent {
  const record = recordOf(raw);
  const allowed = ['kind', 'bookingId', 'key', 'etag', 'createdAt', 'body'];
  if (
    Object.keys(record).some((key) => !allowed.includes(key)) ||
    record.kind !== kind ||
    record.bookingId !== bookingId
  )
    throw new Error('Invalid intent binding');
  const key = text(record, 'key'),
    etag = text(record, 'etag');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) ||
    !/^"[^"\r\n]+"$/.test(etag)
  )
    throw new Error('Invalid intent headers');
  return {
    kind,
    bookingId,
    key,
    etag,
    createdAt: timestamp(record.createdAt),
    body:
      kind === 'cancel'
        ? cancelRequestSchema.parse(record.body)
        : rescheduleRequestSchema.parse(record.body),
  };
}
/** Native caller supplies SecureStore: no auth/PIN, isolated by server-owned guest ID. */
export function intentStore(
  storage: KeyValueStorage,
  guestId: string,
  bookingId: string,
  kind: ChangeKind,
): IntentStore {
  const key = `booking-change.v1.${guestId}.${bookingId}.${kind}`;
  return {
    save: async (intent) => {
      const raw = JSON.stringify(intent);
      parseIntent(raw, bookingId, kind);
      await storage.set(key, raw);
    },
    clear: () => storage.remove(key),
    load: async () => {
      const raw = await storage.get(key);
      return raw === null ? null : parseIntent(raw, bookingId, kind);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
