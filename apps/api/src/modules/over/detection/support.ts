/**
 * Tiện ích thời gian/định danh dùng chung cho phát hiện quá tải (HB-126).
 *
 * Mọi mốc nghiệp vụ đi qua `Clock` tiêm và **giờ danh nghĩa của cơ sở** (BR-GEN-04): `T` là
 * `properties.check_in_time` trên **ngày VN** của ca, hạn xử lý là `T − 24h`. Không suy deadline từ
 * UTC 00:00 và không đọc đồng hồ hệ thống khi quyết định nghiệp vụ.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';

export const DAY_MS = 86_400_000;

export interface PropertyMeta {
  readonly id: string;
  readonly timezone: string;
  readonly checkInTime: string;
}

export interface CaseRow {
  readonly id: string;
  readonly property_id: string;
  readonly date: string;
  readonly room_type_id: string;
  readonly shortage_count: number;
  readonly status: 'OPEN' | 'PROPOSED' | 'RESOLVED' | 'ESCALATED';
  readonly detected_at: Date;
  readonly resolved_at: Date | null;
  readonly escalated_at: Date | null;
  readonly delay_reason: string | null;
  readonly resolved_by: string | null;
  readonly resolution_source: 'USER' | 'SYSTEM' | null;
}

const CASE_STATUS: Readonly<Record<string, CaseRow['status']>> = {
  OPEN: 'OPEN',
  PROPOSED: 'PROPOSED',
  RESOLVED: 'RESOLVED',
  ESCALATED: 'ESCALATED',
};

const RESOLUTION_SOURCE: Readonly<Record<string, 'USER' | 'SYSTEM'>> = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
};

/** Hạ kiểu chuỗi CSDL về union của hợp đồng; giá trị lạ là lỗi dữ liệu, không được đoán. */
export function caseStatus(value: string): CaseRow['status'] {
  const status = CASE_STATUS[value];
  if (status === undefined) throw new Error(`Unknown overbooking case status ${value}`);
  return status;
}

export function resolutionSource(value: string | null): CaseRow['resolution_source'] {
  if (value === null) return null;
  const source = RESOLUTION_SOURCE[value];
  if (source === undefined) throw new Error(`Unknown overbooking resolution source ${value}`);
  return source;
}

/** Ngày lịch `YYYY-MM-DD` theo múi giờ nghiệp vụ. */
export function businessDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const segment = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${segment('year')}-${segment('month')}-${segment('day')}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Khoảng lệch `local − UTC` (ms) của múi giờ tại một thời điểm. */
function offsetAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return wall - at.getTime();
}

/** Thời điểm UTC của `date` + `HH:MM` trong múi giờ `timeZone` (không có DST ở VN nhưng vẫn đúng). */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const base = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  let instant = base;
  for (let pass = 0; pass < 2; pass += 1) instant = base - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
}

/** `T − 24h` với `T = properties.check_in_time` trên ngày thiếu phòng. */
export function resolveDeadline(date: string, checkInTime: string, timeZone: string): Date {
  return new Date(zonedInstant(date, checkInTime, timeZone).getTime() - DAY_MS);
}

export async function propertyMeta(
  db: Prisma.TransactionClient,
  propertyId: string,
): Promise<PropertyMeta> {
  const rows = await db.$queryRaw<
    { id: string; timezone: string; check_in_time: string }[]
  >`SELECT id, timezone, to_char(check_in_time, 'HH24:MI') AS check_in_time
      FROM properties WHERE id=${propertyId}::uuid`;
  const row = rows[0];
  if (row === undefined) throw new Error('Property not found for overbooking detection');
  return { id: row.id, timezone: row.timezone, checkInTime: row.check_in_time };
}

/** Khoá cơ sở tuần tự hoá mọi quyết định mở/đóng ca của cùng một cơ sở (ADR-014). */
export async function lockProperty(
  db: Prisma.TransactionClient,
  propertyId: string,
): Promise<void> {
  await db.$queryRaw`SELECT id FROM properties WHERE id=${propertyId}::uuid FOR UPDATE`;
}

export async function lockCase(
  db: Prisma.TransactionClient,
  caseId: string,
): Promise<CaseRow | undefined> {
  const rows = await db.$queryRaw<CaseRow[]>`
    SELECT id, property_id, date::text AS date, room_type_id, shortage_count, status,
           detected_at, resolved_at, escalated_at, delay_reason, resolved_by, resolution_source
      FROM overbooking_cases WHERE id=${caseId}::uuid FOR UPDATE`;
  return rows[0];
}

export interface AuditShape {
  readonly action: string;
  readonly entityId: string;
  readonly beforeJson: Prisma.InputJsonValue | null;
  readonly afterJson: Prisma.InputJsonValue | null;
  readonly reason?: string | null;
}

/** Ghi nhật ký trong transaction của caller (BR-SYS-01); actor hệ thống bền của F6-D07. */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  clock: Clock,
  shape: AuditShape,
): Promise<void> {
  await new AuditWriter(clock).record(tx, {
    actor: { id: null, role: 'SYSTEM', ip: null, correlationId: randomUUID() },
    action: shape.action,
    entityType: 'OverbookingCase',
    entityId: shape.entityId,
    beforeJson: shape.beforeJson,
    afterJson: shape.afterJson,
    reason: shape.reason ?? null,
  });
}

export interface CaseEvent {
  readonly eventType: 'overbooking.case.opened' | 'overbooking.case.escalated';
  readonly caseId: string;
  readonly propertyId: string;
  readonly date: string;
  readonly roomTypeId: string;
  readonly toStatus: 'OPEN' | 'ESCALATED';
  readonly notifyRole: 'OWNER' | 'FRONT_DESK';
}

/** Một sự kiện outbox cho **mỗi lần** ca đổi trạng thái; caller giữ transaction. */
export async function writeCaseEvent(
  tx: Prisma.TransactionClient,
  event: CaseEvent,
): Promise<void> {
  await tx.outbox_events.create({
    data: {
      event_type: event.eventType,
      aggregate_type: 'OverbookingCase',
      aggregate_id: event.caseId,
      payload_json: {
        caseId: event.caseId,
        propertyId: event.propertyId,
        date: event.date,
        roomTypeId: event.roomTypeId,
        toStatus: event.toStatus,
        notifyRole: event.notifyRole,
      },
    },
  });
}
