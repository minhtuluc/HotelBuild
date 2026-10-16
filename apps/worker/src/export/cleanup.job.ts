import type { JobHandler } from '../jobs/types.js';
import { DEFAULT_EXPORT_DIR, insideExportDir, removeExportFile } from './storage.js';

/** Hàng đợi dọn tệp xuất (khai ở `queues.ts`); chạy lặp theo `EXPORT_CLEANUP_INTERVAL_SECONDS`. */
const QUEUE = 'q.export-cleanup';

interface ExpiredOperationRow {
  readonly result_path: string;
}

/**
 * HB-163 AC2 — dọn tệp báo cáo hết hạn trên đĩa.
 *
 * Chỉ xoá **tệp**: hàng `operations` giữ nguyên (ràng buộc `ck_operations_succeeded` bắt `result_path`
 * NOT NULL khi `SUCCEEDED`, và tuyến tải đã trả 404 khi tệp không còn). Đường dẫn phải nằm trong thư mục
 * xuất; hàng có đường dẫn lạ hoặc tệp xoá lỗi bị bỏ qua để không làm chết lượt dọn của các hàng khác.
 */
export const exportCleanupJob: JobHandler = async (_data, context) => {
  const dir = context.config.EXPORT_DIR ?? DEFAULT_EXPORT_DIR;
  const expired = await context.db.$queryRaw<ExpiredOperationRow[]>`
    SELECT result_path FROM operations
     WHERE result_path IS NOT NULL AND result_expires_at < ${context.clock.now()}
     ORDER BY result_expires_at`;
  let removed = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of expired) {
    if (!insideExportDir(dir, row.result_path)) {
      skipped += 1;
      continue;
    }
    try {
      await removeExportFile(row.result_path);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  context.log({
    queue: QUEUE,
    msg: `dọn tệp xuất: xoá ${removed}, bỏ qua ${skipped} (ngoài thư mục), lỗi ${failed} / ${expired.length} hàng hết hạn`,
  });
};
