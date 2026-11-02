/**
 * Lõi phát hiện quá tải (HB-126): gộp theo `(property, ngày VN, roomType)`, mở/cập nhật ca và áp
 * ranh giới `T − 24h`.
 *
 * Quyết định đã chốt:
 * - ca ngày đã qua luôn `ESCALATED`, không tự `RESOLVED` (BR-OVER-16);
 * - `now ≥ T − 24h` ⇒ `ESCALATED` (một sự kiện outbox cho mỗi lần chuyển trạng thái);
 * - tự đóng **chỉ** khi còn trước `T − 24h` và thiếu thực tế = 0, actor `SYSTEM` (F6-D07);
 * - `detected_at` là lúc biết, không gán hồi tố (HB-126 AC5);
 * - ca đã ra khỏi cửa sổ quét vẫn được giữ để UC-REP-04 đối soát.
 */
import type { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { CaseAction, CaseStatus } from './cases.js';
import { autoResolve, createCase, escalate, updateShortage } from './cases.js';
import { loadPropertyFacts, shortageDates } from './facts.js';
import type { PropertyFacts, TypeFacts } from './facts.js';
import type { CaseRow } from './support.js';
import { caseStatus, resolveDeadline, resolutionSource } from './support.js';

export interface DetectionOutcome {
  readonly caseId: string;
  readonly propertyId: string;
  readonly date: string;
  readonly roomTypeId: string;
  readonly shortageCount: number;
  readonly status: CaseStatus;
  readonly action: CaseAction;
}

export interface DetectionScope {
  /** Chỉ xét đúng các ngày này (guard F4); bỏ trống = cửa sổ 30 ngày tới. */
  readonly dates?: readonly string[];
  readonly roomTypeId?: string;
}

export interface ShortageGroup {
  readonly date: string;
  readonly type: TypeFacts;
  readonly shortage: number;
}

function outcome(row: CaseRow, action: CaseAction): DetectionOutcome {
  return {
    caseId: row.id,
    propertyId: row.property_id,
    date: row.date,
    roomTypeId: row.room_type_id,
    shortageCount: Number(row.shortage_count),
    status: row.status,
    action,
  };
}

export function deadlineOf(property: PropertyFacts, date: string): Date {
  return resolveDeadline(date, property.meta.checkInTime, property.meta.timezone);
}

function inScope(row: CaseRow, scope: DetectionScope): boolean {
  if (scope.roomTypeId !== undefined && row.room_type_id !== scope.roomTypeId) return false;
  if (scope.dates !== undefined && !scope.dates.includes(row.date)) return false;
  return true;
}

async function unresolvedCases(
  db: Prisma.TransactionClient,
  propertyId: string,
): Promise<CaseRow[]> {
  const rows = await db.$queryRaw<
    {
      id: string;
      property_id: string;
      date: string;
      room_type_id: string;
      shortage_count: number;
      status: string;
      detected_at: Date;
      resolved_at: Date | null;
      escalated_at: Date | null;
      delay_reason: string | null;
      resolved_by: string | null;
      resolution_source: string | null;
    }[]
  >`SELECT id, property_id, date::text AS date, room_type_id, shortage_count, status,
           detected_at, resolved_at, escalated_at, delay_reason, resolved_by, resolution_source
      FROM overbooking_cases
     WHERE property_id=${propertyId}::uuid AND status <> 'RESOLVED'
     ORDER BY date, id`;
  return rows.map((row) => ({
    ...row,
    status: caseStatus(row.status),
    resolution_source: resolutionSource(row.resolution_source),
  }));
}

async function applyShortage(
  tx: Prisma.TransactionClient,
  clock: Clock,
  property: PropertyFacts,
  group: ShortageGroup,
  existing: CaseRow | undefined,
  now: Date,
): Promise<DetectionOutcome> {
  const overdue =
    property.today > group.date || now.getTime() >= deadlineOf(property, group.date).getTime();
  if (existing === undefined) {
    const created = await createCase(tx, clock, {
      propertyId: property.meta.id,
      date: group.date,
      roomTypeId: group.type.id,
      shortageCount: group.shortage,
      status: overdue ? 'ESCALATED' : 'OPEN',
    });
    return outcome(created, 'CREATED');
  }
  if (overdue && existing.status !== 'ESCALATED')
    return outcome(await escalate(tx, clock, existing, group.shortage), 'ESCALATED');
  if (Number(existing.shortage_count) !== group.shortage)
    return outcome(await updateShortage(tx, clock, existing, group.shortage), 'UPDATED');
  return outcome(existing, 'UNCHANGED');
}

/** Ca không còn thiếu: quá hạn ⇒ leo thang; còn trước hạn ⇒ tự đóng; ngoài cửa sổ ⇒ giữ nguyên. */
async function reconcileWithoutShortage(
  tx: Prisma.TransactionClient,
  clock: Clock,
  property: PropertyFacts,
  row: CaseRow,
  now: Date,
): Promise<DetectionOutcome | null> {
  const deadline = deadlineOf(property, row.date);
  if (property.today > row.date || now.getTime() >= deadline.getTime()) {
    if (row.status === 'ESCALATED') return null;
    return outcome(await escalate(tx, clock, row, Number(row.shortage_count)), 'ESCALATED');
  }
  if (row.status !== 'OPEN' && row.status !== 'PROPOSED') return null;
  if (row.date < property.today || row.date >= property.windowEnd) return null;
  return outcome(await autoResolve(tx, clock, row), 'AUTO_RESOLVED');
}

/**
 * Quét **một** cơ sở trong transaction của caller. Khoá `properties` trước để tuần tự hoá với
 * `lockStock` của F4 và giữa các lượt quét (ADR-014).
 */
export async function detectProperty(
  tx: Prisma.TransactionClient,
  clock: Clock,
  propertyId: string,
  scope: DetectionScope = {},
): Promise<DetectionOutcome[]> {
  const now = clock.now();
  await tx.$queryRaw`SELECT id FROM properties WHERE id=${propertyId}::uuid FOR UPDATE`;
  const property = await loadPropertyFacts(tx, propertyId, now, scope);
  const unresolved = await unresolvedCases(tx, propertyId);
  const outcomes: DetectionOutcome[] = [];
  const handled = new Set<string>();
  const dates = scope.dates ?? property.dates;
  const types =
    scope.roomTypeId === undefined
      ? property.types
      : property.types.filter((type) => type.id === scope.roomTypeId);
  for (const group of shortageDates(dates, types)) {
    const existing = unresolved.find(
      (row) => row.date === group.date && row.room_type_id === group.type.id,
    );
    if (existing !== undefined) handled.add(existing.id);
    outcomes.push(await applyShortage(tx, clock, property, group, existing, now));
  }
  for (const row of unresolved) {
    if (handled.has(row.id) || !inScope(row, scope)) continue;
    const next = await reconcileWithoutShortage(tx, clock, property, row, now);
    if (next !== null) outcomes.push(next);
  }
  return outcomes;
}
