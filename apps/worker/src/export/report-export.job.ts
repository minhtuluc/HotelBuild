import { z } from 'zod';
import type { JobAttempt, JobContext, JobHandler } from '../jobs/types.js';
import { toCsv } from './csv.js';
import { reportTable } from './report-tables.js';
import { DEFAULT_EXPORT_DIR, exportExtension, writeExportFile } from './storage.js';
import { toXlsx } from './xlsx.js';

/** Hạn tệp xuất: link ký chỉ sống trong khoảng này (HB-163 AC2). */
export const EXPORT_TTL_SECONDS = 900;

/** Mã/nội dung lỗi ổn định cho hàng `FAILED` — không lộ chi tiết nội bộ hay PII (NFR-SEC-03). */
const GENERATION_ERROR_CODE = 'E_GEN_SERVICE_UNAVAILABLE';
const GENERATION_ERROR_MESSAGE = 'Không sinh được tệp báo cáo.';
const EXPORT_FAILED_ACTION = 'REPORT_EXPORT_FAILED';

const payloadSchema = z.strictObject({ operationId: z.uuid() });
const storedPayloadSchema = z.object({
  report: z.enum(['occupancy', 'adr-revpar', 'revenue-by-channel', 'cancellations']),
  format: z.enum(['CSV', 'XLSX']),
  params: z.record(z.string(), z.string()),
});

interface ClaimedOperationRow {
  readonly payload_json: unknown;
  readonly result_json: unknown;
}

/**
 * Còn lượt thử theo hàng đợi? `attempt` vắng (handler gọi thẳng ngoài BullMQ) nghĩa là không còn
 * lượt nào để thử lại ⇒ phải chốt trạng thái ngay, không để thao tác treo.
 */
function hasRetryLeft(attempt: JobAttempt | undefined): attempt is JobAttempt {
  return attempt !== undefined && attempt.attempt < attempt.attempts;
}

/**
 * Chốt `FAILED` **và** ghi nhật ký kiểm toán trong cùng giao dịch: hàng không bao giờ mang trạng thái
 * thất bại mà thiếu vết kiểm toán (BR-SYS-01), và nhật ký chỉ mang mã/nội dung đã che.
 */
async function markFailed(
  context: JobContext,
  operationId: string,
  attempt: JobAttempt | undefined,
): Promise<void> {
  const afterJson = JSON.stringify({
    status: 'FAILED',
    errorCode: GENERATION_ERROR_CODE,
    errorMessage: GENERATION_ERROR_MESSAGE,
    ...(attempt === undefined ? {} : { attempt: attempt.attempt, attempts: attempt.attempts }),
  });
  await context.db.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE operations
         SET status = 'FAILED', error_code = ${GENERATION_ERROR_CODE},
             error_message = ${GENERATION_ERROR_MESSAGE}, finished_at = now(), updated_at = now()
       WHERE id = ${operationId}::uuid`;
    await tx.$executeRaw`
      INSERT INTO audit_logs(
        chain_seq, row_hash, actor_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, reason, at
      ) VALUES (
        0, 'pending-database-trigger', NULL, 'SYSTEM', ${EXPORT_FAILED_ACTION}, 'Operation',
        ${operationId}::uuid,
        ${JSON.stringify({ status: 'RUNNING' })}::jsonb,
        ${afterJson}::jsonb,
        'Hết lượt thử sinh tệp theo hàng đợi', ${context.clock.now()}
      )`;
  });
}

/**
 * HB-163 — sinh tệp CSV/XLSX cho một thao tác xuất báo cáo rồi đóng dấu `SUCCEEDED`.
 *
 * Chịu được retry và crash:
 * - **Giành thao tác** bằng một câu `UPDATE … WHERE status IN ('PENDING','RUNNING') RETURNING …`.
 *   Nhận cả `RUNNING` còn sót (lượt trước chết giữa đường) nên không kẹt; an toàn vì API đặt
 *   `jobId = operationId` nên mỗi thao tác chỉ có một job.
 * - Thao tác đã `SUCCEEDED`/`FAILED` (hoặc không còn) ⇒ không hàng nào được trả về ⇒ no-op.
 * - Lỗi khi **còn lượt thử** chỉ để hàng ở `RUNNING` cho lượt sau; chỉ lượt **cuối** mới đánh `FAILED`
 *   kèm `error_code`/`error_message` đã che + audit.
 */
export const reportExportJob: JobHandler = async (data, context, attempt) => {
  const parsed = payloadSchema.safeParse(data);
  if (!parsed.success) throw new Error('EXPORT_PAYLOAD_INVALID');
  const { operationId } = parsed.data;
  const claimed = await context.db.$queryRaw<ClaimedOperationRow[]>`
    UPDATE operations SET status = 'RUNNING', started_at = now(), updated_at = now()
     WHERE id = ${operationId}::uuid AND status IN ('PENDING', 'RUNNING')
     RETURNING payload_json, result_json`;
  const row = claimed[0];
  if (row === undefined) {
    context.log({
      queue: 'q.report-export',
      msg: 'bỏ qua: thao tác đã SUCCEEDED/FAILED hoặc không còn',
    });
    return;
  }
  try {
    const payload = storedPayloadSchema.safeParse(row.payload_json);
    if (!payload.success) throw new Error('EXPORT_STORED_PAYLOAD_INVALID');
    const table = reportTable(payload.data.report, row.result_json);
    const content =
      payload.data.format === 'CSV'
        ? Buffer.from(toCsv(table.headers, table.rows), 'utf8')
        : toXlsx(table.sheet, table.headers, table.rows);
    const dir = context.config.EXPORT_DIR ?? DEFAULT_EXPORT_DIR;
    const path = await writeExportFile(dir, operationId, payload.data.format, content);
    const expiresAt = new Date(context.clock.now().getTime() + EXPORT_TTL_SECONDS * 1000);
    await context.db.$executeRaw`
      UPDATE operations
         SET status = 'SUCCEEDED', result_ref = ${`/api/v1/operations/${operationId}/download`},
             result_path = ${path}, result_expires_at = ${expiresAt},
             result_json = NULL, finished_at = now(), updated_at = now()
       WHERE id = ${operationId}::uuid`;
    context.log({
      queue: 'q.report-export',
      msg: `đã sinh tệp ${exportExtension(payload.data.format)} (${content.byteLength} byte)`,
    });
  } catch (error) {
    if (hasRetryLeft(attempt)) {
      context.log({
        queue: 'q.report-export',
        msg: `lượt ${attempt.attempt}/${attempt.attempts} lỗi; để hàng đợi thử lại`,
      });
    } else {
      await markFailed(context, operationId, attempt);
    }
    throw error;
  }
};
