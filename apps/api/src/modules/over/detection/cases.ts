/**
 * Ghi ca quá tải: mở, cập nhật thiếu, leo thang và tự đóng (F6-D07).
 *
 * Mọi lần ghi nằm trong transaction của caller cùng audit/outbox (BR-SYS-01, AC9): ca + nhật ký + sự
 * kiện chuyển trạng thái commit/rollback như một khối. Tự đóng chỉ dùng actor hệ thống bền
 * `resolution_source = 'SYSTEM'` + `resolved_by = NULL`, không tạo người xử lý giả.
 */
import { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { CaseRow } from './support.js';
import { caseStatus, resolutionSource, writeAudit, writeCaseEvent } from './support.js';

export type CaseStatus = 'OPEN' | 'PROPOSED' | 'RESOLVED' | 'ESCALATED';
export type CaseAction = 'CREATED' | 'UPDATED' | 'ESCALATED' | 'AUTO_RESOLVED' | 'UNCHANGED';

export interface CaseSnapshot {
  readonly status: CaseStatus;
  readonly shortageCount: number;
  readonly escalatedAt: string | null;
  readonly resolvedAt: string | null;
  readonly resolutionSource: string | null;
}

export interface CaseIdentity {
  readonly propertyId: string;
  readonly date: string;
  readonly roomTypeId: string;
}

const caseSelect = {
  id: true,
  property_id: true,
  date: true,
  room_type_id: true,
  shortage_count: true,
  status: true,
  detected_at: true,
  resolved_at: true,
  escalated_at: true,
  delay_reason: true,
  resolved_by: true,
  resolution_source: true,
} satisfies Prisma.overbooking_casesSelect;

type SelectedCase = Prisma.overbooking_casesGetPayload<{ select: typeof caseSelect }>;

function toCaseRow(row: SelectedCase): CaseRow {
  return {
    ...row,
    date: row.date.toISOString().slice(0, 10),
    status: caseStatus(row.status),
    resolution_source: resolutionSource(row.resolution_source),
  };
}

export function snapshot(row: CaseRow): CaseSnapshot {
  return {
    status: row.status,
    shortageCount: Number(row.shortage_count),
    escalatedAt: row.escalated_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolutionSource: row.resolution_source,
  };
}

function civilDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function createCase(
  tx: Prisma.TransactionClient,
  clock: Clock,
  input: CaseIdentity & {
    readonly shortageCount: number;
    readonly status: Extract<CaseStatus, 'OPEN' | 'ESCALATED'>;
  },
): Promise<CaseRow> {
  const now = clock.now();
  const created = toCaseRow(
    await tx.overbooking_cases.create({
      data: {
        property_id: input.propertyId,
        date: civilDate(input.date),
        room_type_id: input.roomTypeId,
        shortage_count: input.shortageCount,
        status: input.status,
        detected_at: now,
        escalated_at: input.status === 'ESCALATED' ? now : null,
        created_at: now,
        updated_at: now,
      },
      select: caseSelect,
    }),
  );
  await writeAudit(tx, clock, {
    action: 'CREATE',
    entityId: created.id,
    beforeJson: null,
    afterJson: { ...snapshot(created) },
  });
  await writeCaseEvent(tx, {
    eventType:
      created.status === 'ESCALATED' ? 'overbooking.case.escalated' : 'overbooking.case.opened',
    caseId: created.id,
    propertyId: created.property_id,
    date: created.date,
    roomTypeId: created.room_type_id,
    toStatus: created.status === 'ESCALATED' ? 'ESCALATED' : 'OPEN',
    notifyRole: created.status === 'ESCALATED' ? 'OWNER' : 'FRONT_DESK',
  });
  return created;
}

export async function updateShortage(
  tx: Prisma.TransactionClient,
  clock: Clock,
  before: CaseRow,
  shortageCount: number,
): Promise<CaseRow> {
  const updated = toCaseRow(
    await tx.overbooking_cases.update({
      where: { id: before.id },
      data: { shortage_count: shortageCount, updated_at: clock.now() },
      select: caseSelect,
    }),
  );
  await writeAudit(tx, clock, {
    action: 'UPDATE',
    entityId: updated.id,
    beforeJson: { ...snapshot(before) },
    afterJson: { ...snapshot(updated) },
  });
  return updated;
}

export async function escalate(
  tx: Prisma.TransactionClient,
  clock: Clock,
  before: CaseRow,
  shortageCount: number,
): Promise<CaseRow> {
  const now = clock.now();
  const escalated = toCaseRow(
    await tx.overbooking_cases.update({
      where: { id: before.id },
      data: {
        status: 'ESCALATED',
        escalated_at: now,
        shortage_count: shortageCount,
        updated_at: now,
      },
      select: caseSelect,
    }),
  );
  await writeAudit(tx, clock, {
    action: 'UPDATE',
    entityId: escalated.id,
    beforeJson: { ...snapshot(before) },
    afterJson: { ...snapshot(escalated) },
  });
  await writeCaseEvent(tx, {
    eventType: 'overbooking.case.escalated',
    caseId: escalated.id,
    propertyId: escalated.property_id,
    date: escalated.date,
    roomTypeId: escalated.room_type_id,
    toStatus: 'ESCALATED',
    notifyRole: 'OWNER',
  });
  return escalated;
}

/** F6-D07: còn trước `T − 24h` và thiếu thực tế = 0 ⇒ đóng bằng actor `SYSTEM`, giữ `shortage_count`. */
export async function autoResolve(
  tx: Prisma.TransactionClient,
  clock: Clock,
  before: CaseRow,
): Promise<CaseRow> {
  const now = clock.now();
  const resolved = toCaseRow(
    await tx.overbooking_cases.update({
      where: { id: before.id },
      data: {
        status: 'RESOLVED',
        resolved_at: now,
        resolved_by: null,
        resolution_source: 'SYSTEM',
        updated_at: now,
      },
      select: caseSelect,
    }),
  );
  await writeAudit(tx, clock, {
    action: 'UPDATE',
    entityId: resolved.id,
    beforeJson: { ...snapshot(before) },
    afterJson: { ...snapshot(resolved) },
    reason: 'AUTO_RESOLVED_SHORTAGE_CLEARED',
  });
  return resolved;
}
