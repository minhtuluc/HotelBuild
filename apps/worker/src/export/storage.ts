/**
 * Tệp báo cáo tạm của worker (HB-163): ghi ra thư mục có kiểm soát, đọc lại và dọn.
 *
 * Tệp nằm trong thư mục do người tích hợp chỉ định (ổ tạm của worker) và có hạn —
 * API ký link tải hạn ngắn; `removeExportFile` được gọi khi hết hạn nên phải chịu
 * được trường hợp tệp đã bị dọn trước đó.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Định dạng báo cáo worker hỗ trợ (khớp cột `format` của thao tác xuất ở API). */
export type ExportFormat = 'CSV' | 'XLSX';

/** Cùng giá trị mặc định với `apps/api` (worker ghi tệp, API đọc tệp để phục vụ link tải). */
export const DEFAULT_EXPORT_DIR = join(tmpdir(), 'pinehill-exports');

/**
 * Tệp xuất chỉ sống trong thư mục cấu hình; chặn mọi đường dẫn khác (không đọc/xoá tệp tuỳ ý).
 * Chép logic của `apps/api/src/modules/sys/operations/service.ts` — worker không import chéo app.
 */
export function insideExportDir(exportDir: string, path: string): boolean {
  const base = exportDir.endsWith('/') ? exportDir : `${exportDir}/`;
  return path.startsWith(base) && !path.includes('..');
}

const EXTENSIONS: Record<ExportFormat, 'csv' | 'xlsx'> = { CSV: 'csv', XLSX: 'xlsx' };

/** Một nguồn duy nhất cho đuôi tệp — dùng cả khi đặt tên tệp và khi trả content-type. */
export function exportExtension(format: ExportFormat): 'csv' | 'xlsx' {
  return EXTENSIONS[format];
}

/** `operationId` là ID thao tác do API cấp, chỉ dùng để đặt tên tệp trong `dir`. */
function assertSafeOperationId(operationId: string): void {
  if (operationId.length === 0 || /[\\/\u0000]/.test(operationId) || operationId.includes('..')) {
    throw new Error('operationId không hợp lệ để đặt tên tệp xuất');
  }
}

/**
 * Ghi tệp `report-<operationId>.<ext>` vào `dir` (tạo thư mục nếu thiếu) và trả
 * **đường dẫn tuyệt đối** để phần ký link tải dùng thẳng.
 */
export async function writeExportFile(
  dir: string,
  operationId: string,
  format: ExportFormat,
  content: Uint8Array,
): Promise<string> {
  assertSafeOperationId(operationId);
  await mkdir(dir, { recursive: true });
  const path = resolve(join(dir, `report-${operationId}.${exportExtension(format)}`));
  await writeFile(path, content);
  return path;
}

/** Đọc tệp báo cáo đã ghi; tệp không còn thì lỗi ENOENT nổi lên cho người gọi xử lý. */
export async function readExportFile(path: string): Promise<Buffer> {
  return readFile(path);
}

/** Dọn tệp theo hạn; tệp đã bị dọn trước đó (hoặc chưa từng có) không phải lỗi. */
export async function removeExportFile(path: string): Promise<void> {
  await rm(path, { force: true });
}
