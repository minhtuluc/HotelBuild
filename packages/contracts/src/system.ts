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

/** Kiểu giá trị tham số: quyết định ô nhập kiểm tại chỗ ở SCR-17. */
export const systemSettingValueTypeSchema = z.enum(['INTEGER', 'BOOLEAN', 'STRING']);

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

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type SystemSettingUpdateRequest = z.infer<typeof systemSettingUpdateRequestSchema>;
export type SystemSetting = z.infer<typeof systemSettingSchema>;
export type SystemSettingValueType = z.infer<typeof systemSettingValueTypeSchema>;
export type BackupRequest = z.infer<typeof backupRequestSchema>;
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;
