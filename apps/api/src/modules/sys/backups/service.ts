/**
 * HB-246 (phần API của HB-179) — sao lưu & diễn tập phục hồi theo yêu cầu, trạng thái cho SCR-18.
 *
 * API **không** chạy pgBackRest hay lệnh hệ thống nào: nó chỉ ghi yêu cầu vào `operations` (cùng audit,
 * trong transaction idempotency). Sidecar `backup` (infra/prod/backup/backup-loop.sh) giành việc bằng
 * `FOR UPDATE SKIP LOCKED`, chạy, rồi chốt `result_json`/`error_code`. Diễn tập chạy trên volume tạm với
 * socket/cổng riêng — không có tham số nào từ client chạm đường dẫn hay URL CSDL (api.md §2.14).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type {
  BackupOperation,
  BackupRequest,
  BackupStatus,
  OperationRef,
  RestoreRequest,
} from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { backupSets } from './catalog.js';
import { busy, invalid, missingBackup } from './validation.js';

type Tx = Prisma.TransactionClient;
const KINDS = ['BACKUP', 'RESTORE_DRILL'] as const;
type Kind = (typeof KINDS)[number];

interface OperationRow {
  id: string;
  kind: string;
  status: string;
  payload_json: unknown;
  result_json: unknown;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

interface ArchiverRow {
  archived_count: bigint;
  failed_count: bigint;
  last_archived_time: Date | null;
  last_failed_time: Date | null;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

function operationView(row: OperationRow): BackupOperation | null {
  const kind = KINDS.find((item) => item === row.kind);
  const status = (['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const).find(
    (item) => item === row.status,
  );
  if (kind === undefined || status === undefined) return null;
  return {
    operationId: row.id,
    kind,
    status,
    requestedAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    request: record(row.payload_json),
    result: row.result_json === null ? null : record(row.result_json),
    errorCode: row.error_code,
  };
}

/** `uq_operations_backup_active` vi phạm ⇒ hai lệnh lọt kiểm tra cùng lúc; trả đúng 409 như kiểm tra. */
function activeViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2010' &&
    JSON.stringify(error.meta ?? {}).includes('uq_operations_backup_active')
  );
}

export class BackupService {
  constructor(
    readonly db: PrismaClient,
    readonly audit: AuditWriter,
    readonly clock: Clock,
  ) {}

  async status(): Promise<BackupStatus> {
    const catalog = await this.db.backup_catalog.findUnique({ where: { id: 1 } });
    const [archiver] = await this.db.$queryRaw<ArchiverRow[]>`
      SELECT archived_count, failed_count, last_archived_time, last_failed_time FROM pg_stat_archiver`;
    const rows = await this.db.$queryRaw<OperationRow[]>`
      SELECT id, kind, status, payload_json, result_json, error_code, created_at, started_at, finished_at
        FROM operations WHERE kind IN ('BACKUP','RESTORE_DRILL')
       ORDER BY created_at DESC, id DESC LIMIT 20`;
    const lastArchived = archiver?.last_archived_time ?? null;
    return {
      catalogRefreshedAt: catalog?.refreshed_at.toISOString() ?? null,
      backups: backupSets(catalog?.info_json ?? []),
      archive: {
        archivedCount: Number(archiver?.archived_count ?? 0n),
        failedCount: Number(archiver?.failed_count ?? 0n),
        lastArchivedAt: lastArchived?.toISOString() ?? null,
        lastFailedAt: archiver?.last_failed_time?.toISOString() ?? null,
      },
      secondsSinceLastArchive:
        lastArchived === null
          ? null
          : Math.max(0, Math.floor((this.clock.now().getTime() - lastArchived.getTime()) / 1000)),
      operations: rows.map(operationView).filter((row) => row !== null),
    };
  }

  /** `FULL` ⇒ `pgbackrest backup --type=full`; `PITR` ⇒ `--type=incr` (pgBackRest tự nâng lên full nếu chưa có). */
  async requestBackup(tx: Tx, actor: AuthorizedActor, input: BackupRequest): Promise<OperationRef> {
    return this.enqueue(tx, actor, 'BACKUP', { mode: input.mode }, null);
  }

  /**
   * Diễn tập: `backupId` phải có trong ảnh chụp kho và `targetTimestamp` nằm trong
   * `[finishedAt của bản đó, bây giờ]` — pgBackRest không replay được tới mốc trước khi bản gốc xong.
   */
  async requestRestore(
    tx: Tx,
    actor: AuthorizedActor,
    backupId: string,
    input: RestoreRequest,
  ): Promise<OperationRef> {
    const catalog = await tx.backup_catalog.findUnique({ where: { id: 1 } });
    const set = backupSets(catalog?.info_json ?? []).find((item) => item.backupId === backupId);
    if (set === undefined) throw missingBackup();
    const target = Date.parse(input.targetTimestamp);
    if (target < Date.parse(set.finishedAt))
      throw invalid('`targetTimestamp` phải sau thời điểm bản sao lưu hoàn tất.');
    if (target > this.clock.now().getTime())
      throw invalid('`targetTimestamp` không được ở tương lai.');
    return this.enqueue(
      tx,
      actor,
      'RESTORE_DRILL',
      { backupId, targetTimestamp: input.targetTimestamp },
      input.reason,
    );
  }

  private async enqueue(
    tx: Tx,
    actor: AuthorizedActor,
    kind: Kind,
    payload: Record<string, string>,
    reason: string | null,
  ): Promise<OperationRef> {
    const active = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM operations
       WHERE kind IN ('BACKUP','RESTORE_DRILL') AND status IN ('PENDING','RUNNING') LIMIT 1`;
    if (active.length > 0) throw busy();
    const operationId = randomUUID();
    try {
      await tx.$executeRaw`
        INSERT INTO operations(id, kind, status, requested_by, payload_json)
        VALUES(${operationId}::uuid, ${kind}, 'PENDING', ${actor.id}::uuid, ${JSON.stringify(payload)}::jsonb)`;
    } catch (error) {
      if (activeViolation(error)) throw busy();
      throw error;
    }
    await this.audit.record(tx, {
      actor,
      action: kind === 'BACKUP' ? 'BACKUP_REQUESTED' : 'RESTORE_DRILL_REQUESTED',
      entityType: 'Operation',
      entityId: operationId,
      beforeJson: null,
      afterJson: payload,
      reason,
    });
    return { operationId, status: 'PENDING', statusUrl: `/api/v1/operations/${operationId}` };
  }
}
