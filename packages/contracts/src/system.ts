/** Hợp đồng SYS — api.md §2.13; `AuditLog` chỉ ghi thêm (§2.14, BR-SYS-01). */
import { z } from 'zod';
import { isoUtcTimestampSchema } from './common.js';

export const auditLogQuerySchema = z.strictObject({
  actorId: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  from: isoUtcTimestampSchema.optional(),
  to: isoUtcTimestampSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export const auditLogEntrySchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  reason: z.string().min(1).nullable(),
  beforeJson: z.string().nullable(),
  afterJson: z.string().nullable(),
  createdAt: isoUtcTimestampSchema,
});

/**
 * Bổ sung tuyến đọc tham số (HB-044 SCR-17, chủ dự án duyệt 05/10/2026): api.md §2.13 chỉ có
 * `PUT /system-settings/{key}` nên màn hình không biết giá trị hiện tại, kiểu giá trị hay phiên bản.
 */
export const systemSettingQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

/**
 * Kiểu giá trị tham số — khớp `CHECK (value_type IN ('STRING','NUMBER','BOOLEAN','JSON'))`
 * của csdl §3 (nguồn chân lý), không tự đặt tập giá trị khác.
 */
export const systemSettingValueTypeSchema = z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON']);

export const systemSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  valueType: systemSettingValueTypeSchema,
  description: z.string().min(1),
  updatedBy: z.string().min(1),
  updatedAt: isoUtcTimestampSchema,
  version: z.number().int().min(0),
});

/** `PUT /system-settings/{key}` — đổi tham số phải kèm lý do và ghi `AuditLog` cùng transaction (BR-SYS-02, BR-GEN-07). */
export const systemSettingUpdateRequestSchema = z.strictObject({
  value: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export const backupRequestSchema = z.strictObject({
  mode: z.enum(['PITR', 'FULL']),
});

/** Phục hồi chỉ nhận mốc thời gian + lý do, **không** nhận đường dẫn/URL CSDL (§2.14, BR-SYS-03). */
export const restoreRequestSchema = z.strictObject({
  targetTimestamp: isoUtcTimestampSchema,
  reason: z.string().min(1).max(500),
});

/**
 * HB-246: `GET /system/backups` — trạng thái sao lưu cho SCR-18. Nguồn: ảnh chụp `pgbackrest info` do
 * sidecar ghi (`backups`, `catalogRefreshedAt`), `pg_stat_archiver` (`archive`) và lịch sử `operations`.
 * `backupId` là nhãn pgBackRest (vd. `20261113-190002F`), dùng làm tham số của lệnh diễn tập phục hồi.
 */
export const backupSetSchema = z.object({
  backupId: z.string().regex(/^\d{8}-\d{6}F(_\d{8}-\d{6}[DI])?$/),
  type: z.enum(['FULL', 'DIFF', 'INCR']),
  startedAt: isoUtcTimestampSchema,
  finishedAt: isoUtcTimestampSchema,
  /** Dung lượng CSDL lúc sao lưu và dung lượng đã nén/mã hoá trong kho (byte). */
  databaseSizeBytes: z.number().int().min(0).nullable(),
  repositorySizeBytes: z.number().int().min(0).nullable(),
});

export const backupOperationSchema = z.object({
  operationId: z.string().min(1),
  kind: z.enum(['BACKUP', 'RESTORE_DRILL']),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  requestedAt: isoUtcTimestampSchema,
  startedAt: isoUtcTimestampSchema.nullable(),
  finishedAt: isoUtcTimestampSchema.nullable(),
  /** Tham số đã yêu cầu: `mode` (sao lưu) hoặc `backupId` + `targetTimestamp` (diễn tập). */
  request: z.record(z.string(), z.unknown()),
  /** Biên bản: nhãn bản sao lưu mới, hoặc số đo RTO và đối soát sau phục hồi. */
  result: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().min(1).nullable(),
});

export const backupStatusSchema = z.object({
  /** `null` = sidecar chưa ghi ảnh chụp nào (chưa chạy hoặc môi trường không có kho sao lưu). */
  catalogRefreshedAt: isoUtcTimestampSchema.nullable(),
  /** Mới nhất trước. */
  backups: z.array(backupSetSchema),
  archive: z.object({
    archivedCount: z.number().int().min(0),
    failedCount: z.number().int().min(0),
    lastArchivedAt: isoUtcTimestampSchema.nullable(),
    lastFailedAt: isoUtcTimestampSchema.nullable(),
  }),
  /** Số giây kể từ WAL cuối cùng lên kho — ước lượng mất dữ liệu nếu sự cố xảy ra lúc này (RPO ≤ 900). */
  secondsSinceLastArchive: z.number().int().min(0).nullable(),
  /** 20 thao tác sao lưu/diễn tập gần nhất, mới nhất trước. */
  operations: z.array(backupOperationSchema),
});

export type BackupSet = z.infer<typeof backupSetSchema>;
export type BackupOperation = z.infer<typeof backupOperationSchema>;
export type BackupStatus = z.infer<typeof backupStatusSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type SystemSettingUpdateRequest = z.infer<typeof systemSettingUpdateRequestSchema>;
export type SystemSetting = z.infer<typeof systemSettingSchema>;
export type SystemSettingValueType = z.infer<typeof systemSettingValueTypeSchema>;
export type BackupRequest = z.infer<typeof backupRequestSchema>;
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;
