/**
 * Handler thật của `q.no-show-mark` (HB-147; BR-CANCEL-10, BR-FO-02).
 *
 * Hàng đợi chạy lặp mỗi phút (`NO_SHOW_MARK_INTERVAL_SECONDS`) và tự quyết định ứng viên bằng giờ CSDL;
 * payload rỗng nên job mất/khởi động lại không làm mất việc — lượt sau quét lại. Booking đã check-in
 * hoặc đã đổi trạng thái không lọt vào danh sách (điều kiện `status = 'CONFIRMED'` trong SQL).
 */
import { z } from 'zod';
import { NO_SHOW_QUEUE, prismaNoShowPort, sweepNoShows } from './mark.js';
import type { JobHandler } from '../types.js';

/** Trần số trang mỗi lượt: nhịp một phút vẫn đủ cho vài trăm booking/đêm, nhưng không treo lượt quét. */
export const NO_SHOW_MAX_PAGES = 5;

export const noShowMarkPayloadSchema = z.strictObject({});

export const noShowMarkJob: JobHandler = async (data, context) => {
  const payload = noShowMarkPayloadSchema.safeParse(data);
  // Payload sai là lỗi lập trình của bên phát job: ném mã ổn định, không kèm nội dung payload vào log.
  if (!payload.success) throw new Error('NO_SHOW_PAYLOAD_INVALID');
  const options = {
    markTime: context.config.NO_SHOW_MARK_TIME,
    batchSize: context.config.NO_SHOW_BATCH_SIZE,
    maxPages: NO_SHOW_MAX_PAGES,
  };
  const report = await sweepNoShows(
    prismaNoShowPort(context.db, options.markTime),
    options,
    context.log,
  );
  context.log({
    queue: NO_SHOW_QUEUE,
    msg:
      `quét no-show: ${report.scanned} ứng viên, ${report.marked} đánh dấu, ` +
      `${report.skipped} bỏ qua, ${report.failed} lỗi, nhả ${report.releasedAssignments} phân công, ` +
      `phạt ${report.penaltyTotal} VND, ${report.pages} trang`,
  });
};
