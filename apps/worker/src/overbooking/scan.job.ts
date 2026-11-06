/**
 * HB-127 — tiêu thụ `q.overbooking-scan`: gọi **đúng một lần** use case phát hiện của HB-126 qua
 * composition runtime (`@pinehill/api/worker-runtime/overbooking-scan.js`).
 *
 * Handler không có logic booking/tiền/tồn: cửa sổ 30 ngày VN, gộp ca, ranh giới T−24h, ca ngày đã qua
 * và bản ghi `overbooking_scan_runs` (RUNNING → SUCCEEDED/FAILED, giữ mốc thành công cũ) đều do use case
 * đảm nhiệm. Handler cũng không gửi thông báo hay gọi PSP; outbox do chính use case ghi trong transaction.
 *
 * Lỗi: ghi log với **mã ổn định** rồi ném lại mã đó (không ném thông điệp thô vì `failedReason` của BullMQ
 * nằm lại trong Redis). Không nuốt lỗi rồi ACK — BullMQ thử lại, lượt sau hội tụ nhờ khoá RUNNING mỗi cơ sở.
 */
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { OVERBOOKING_SCAN_QUEUE } from '../queues.js';
import type { JobHandler } from '../jobs/types.js';
import { loadScanRuntime } from './runtime.js';
import type { ScanResultLike } from './runtime.js';

export const SCAN_FAILED_CODE = 'OVERBOOKING_SCAN_FAILED';
const jobData = z.strictObject({});
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,60}$/;

function errorCodeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return SCAN_FAILED_CODE;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' && STABLE_CODE.test(code) ? code : SCAN_FAILED_CODE;
}

const count = (result: ScanResultLike, action: string): number =>
  result.outcomes.filter((outcome) => outcome.action === action).length;

export const overbookingScanJob: JobHandler = async (data, context, _attempt, job) => {
  const base = {
    queue: OVERBOOKING_SCAN_QUEUE,
    ...(job?.id === undefined ? {} : { jobId: job.id }),
  };
  if (!jobData.safeParse(data ?? {}).success) {
    context.log({ ...base, msg: 'bỏ qua job sai hình dạng', errorCode: 'OVERBOOKING_JOB_INVALID' });
    return;
  }
  const started = performance.now();
  context.log({ ...base, msg: 'bắt đầu quét quá tải' });
  try {
    const runtime = (await loadScanRuntime()).createOverbookingScanRuntime({
      db: context.db,
      clock: context.clock,
    });
    const result = await runtime.scan();
    context.log({
      ...base,
      msg:
        `quét quá tải xong: ${result.outcomes.length} kết cục, ${count(result, 'CREATED')} ca mới, ` +
        `${count(result, 'ESCALATED')} leo thang, ${Math.round(performance.now() - started)} ms, 0 lỗi`,
    });
  } catch (error) {
    const code = errorCodeOf(error);
    context.log({
      ...base,
      msg: `quét quá tải lỗi sau ${Math.round(performance.now() - started)} ms`,
      errorCode: code,
    });
    throw new Error(code);
  }
};
