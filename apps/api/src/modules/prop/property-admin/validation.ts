import {
  propertyUpdateRequestSchema,
  roomTypeCreateRequestSchema,
  roomTypeUpdateRequestSchema,
  roomCreateRequestSchema,
  roomUpdateRequestSchema,
  connectingRoomRequestSchema,
} from '@pinehill/contracts';
import type { room_types } from '@prisma/client';
import { invalid, uuid } from './support.js';
import { AppError } from '../../../common/app-error.js';
import { safeAuditText } from '../../sys/audit-logs/safe-text.js';
export function safeText(value: string) {
  return safeAuditText(
    value.replace(
      /(\btoken["']?\s*[:=]\s*["']?)([^;\r\n,]+)/giu,
      (_match: string, label: string) => label + '[REDACTED]',
    ),
  );
}
export type Kind = 'property' | 'type' | 'room' | 'link';
export const configuration = () =>
  new AppError(422, 'E_RATE_CONFIGURATION_INVALID', 'Cấu hình sức chứa hoặc giá không hợp lệ.');
export function reason(value: string | undefined, required = false) {
  if (required && (!value || !value.trim())) throw invalid();
  return safeText(value?.trim() || 'Configuration change');
}
export function propertyInput(body: unknown) {
  const p = propertyUpdateRequestSchema.safeParse(body);
  if (!p.success) throw invalid();
  const q = p.data;
  if (Object.keys(q).every((k) => k === 'reason')) throw invalid();
  if (q.overbookLimitPct !== undefined && q.overbookLimitPct > 5) throw invalid();
  for (const time of [q.checkInTime, q.checkOutTime])
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw invalid();
  return { ...q, reason: reason(q.reason, true) };
}
export function typeCreate(body: unknown) {
  const p = roomTypeCreateRequestSchema.safeParse(body);
  if (!p.success) throw configuration();
  return { ...p.data, propertyId: uuid(p.data.propertyId) };
}
export function typeUpdate(body: unknown) {
  const p = roomTypeUpdateRequestSchema.safeParse(body);
  if (!p.success) throw configuration();
  if (Object.keys(p.data).every((k) => k === 'reason')) throw invalid();
  return { ...p.data, reason: reason(p.data.reason, true) };
}
function capacityType(
  row: Pick<
    room_types,
    'code' | 'capacity_adults' | 'allow_shared' | 'base_price' | 'min_price' | 'max_price'
  >,
  suppliedBeds?: number,
) {
  const capacity: Readonly<Record<string, number>> = { STD: 2, SUP: 2, DLX: 3, FAM: 4, DOR: 6 };
  if (capacity[row.code] === undefined || row.capacity_adults !== capacity[row.code])
    throw configuration();
  if (row.allow_shared !== (row.code === 'DOR')) throw configuration();
  const canonical = row.code === 'DOR' ? 6 : row.capacity_adults;
  if (suppliedBeds !== undefined && suppliedBeds !== canonical) throw configuration();
}
export function validateType(row: Parameters<typeof capacityType>[0], suppliedBeds?: number) {
  capacityType(row, suppliedBeds);
  if (row.min_price > row.base_price || row.base_price > row.max_price) throw configuration();
  for (const amount of [row.min_price, row.base_price, row.max_price])
    if (amount < 1n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw configuration();
}
export function roomCreate(body: unknown) {
  const p = roomCreateRequestSchema.safeParse(body);
  if (!p.success) throw invalid();
  return {
    ...p.data,
    propertyId: uuid(p.data.propertyId),
    roomTypeId: uuid(p.data.roomTypeId),
    note: p.data.note ? safeText(p.data.note) : undefined,
    reason: reason(p.data.reason),
  };
}
export function roomUpdate(body: unknown) {
  const p = roomUpdateRequestSchema.safeParse(body);
  if (!p.success || Object.keys(p.data).every((k) => k === 'reason')) throw invalid();
  return {
    ...p.data,
    note: typeof p.data.note === 'string' ? safeText(p.data.note) : p.data.note,
    reason: reason(p.data.reason),
  };
}
export function linkInput(body: unknown) {
  const p = connectingRoomRequestSchema.safeParse(body);
  if (!p.success) throw invalid();
  return {
    connectingRoomId: p.data.connectingRoomId === null ? null : uuid(p.data.connectingRoomId),
  };
}
