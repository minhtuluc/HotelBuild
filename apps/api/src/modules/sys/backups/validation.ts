import { backupRequestSchema, restoreRequestSchema } from '@pinehill/contracts';
import type { BackupRequest, RestoreRequest } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';

export const invalid = (message = 'Yêu cầu sao lưu không hợp lệ.') =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', message);
export const missingBackup = () =>
  new AppError(404, 'E_GEN_NOT_FOUND', 'Không tìm thấy bản sao lưu trong kho.');
export const busy = () =>
  new AppError(
    409,
    'E_SYS_REQUEST_IN_PROGRESS',
    'Đang có một thao tác sao lưu hoặc diễn tập chờ/chạy; đợi xong rồi yêu cầu lại.',
  );

/** Nhãn pgBackRest: full `YYYYMMDD-HHMMSSF`, diff/incr thêm `_YYYYMMDD-HHMMSS{D|I}`. */
export const BACKUP_LABEL = /^\d{8}-\d{6}F(_\d{8}-\d{6}[DI])?$/;

export function backupInput(body: unknown): BackupRequest {
  const parsed = backupRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export function restoreInput(body: unknown): RestoreRequest {
  const parsed = restoreRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export function backupIdParam(params: unknown): string {
  const value =
    typeof params === 'object' && params !== null && 'backupId' in params
      ? params.backupId
      : undefined;
  if (typeof value !== 'string' || !BACKUP_LABEL.test(value)) throw invalid('`backupId` sai dạng.');
  return value;
}
