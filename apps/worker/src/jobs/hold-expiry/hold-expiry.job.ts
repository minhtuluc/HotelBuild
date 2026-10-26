/**
 * Handler thật của `q.hold-expiry` (HB-078, BR-BOOK-08/18, BR-INV-04, NFR-REL-02).
 *
 * Hàng đợi chỉ là **nhịp chạy**: payload không mang dữ liệu nghiệp vụ, công việc đọc từ PostgreSQL nên mất
 * job trên Redis hay khởi động lại tiến trình đều không làm hold "sống lại" (cùng lối với `q.outbox-relay`).
 *
 * Hai chế độ trên **cùng một hàng đợi**, khai bằng `data.mode`:
 * - `SWEEP` (mặc định, nhịp 30 giây): quét tối đa một trang — nhả tồn cho hold quá hạn, giữ lượt chạy ngắn;
 * - `RECONCILE` (nhịp 900 giây): quét nhiều trang để **bắt sót** rồi **đối chiếu projection Redis**
 *   (`hold:<bookingId>`) với `bookings.hold_expires_at`. Redis hỏng chỉ làm hỏng phần đối chiếu: lượt quét
 *   CSDL đã xong và lượt sau sẽ đối chiếu lại, nên Redis không phải điều kiện chạy (AC4).
 *
 * Lỗi Redis/CSDL của phần đối chiếu được **ghi bằng mã an toàn** rồi bỏ qua, không ném ra ngoài: nhịp 900
 * giây là lưới an toàn, thử lại dồn dập không giúp gì và log thô có thể mang bí mật/PII (NFR-SEC-04).
 */
import { z } from 'zod';
import { HOLD_QUEUE, prismaHoldExpiryPort, safeErrorCode, sweepDueHolds } from './expire.js';
import { createHoldProjectionSession, reconcileHoldProjection } from './projection.js';
import type { HoldProjectionSession } from './projection.js';
import type { JobHandler } from '../types.js';

/** Hai chế độ chạy của hàng đợi; nhịp do `worker-app.ts` đăng ký qua `data.mode`. */
export const HOLD_EXPIRY_SWEEP = 'SWEEP';
export const HOLD_EXPIRY_RECONCILE = 'RECONCILE';

export const holdExpiryPayloadSchema = z.strictObject({
  mode: z.enum([HOLD_EXPIRY_SWEEP, HOLD_EXPIRY_RECONCILE]).default(HOLD_EXPIRY_SWEEP),
});

/** Trần trang của lượt đối chiếu: đủ rộng để bắt sót, vẫn chặn lượt quét treo khi tồn đọng bất thường. */
export const RECONCILE_MAX_PAGES = 20;

/** Nhịp 30 giây ⇒ trần SLA 60 giây (BR-BOOK-18) là **hai** nhịp; quá mốc đó tính là bỏ sót. */
export const MISSED_GRACE_CYCLES = 2;

export interface HoldExpiryJobDeps {
  /** Bơm được để test điều khiển phiên Redis; mặc định nối `REDIS_URL` đã kiểm của tiến trình. */
  readonly createProjection?: (redisUrl: string) => HoldProjectionSession;
}

export function createHoldExpiryJob(deps: HoldExpiryJobDeps = {}): JobHandler {
  return async (data, context) => {
    const payload = holdExpiryPayloadSchema.safeParse(data);
    // Payload sai là lỗi lập trình của bên phát job: ném mã ổn định, không kèm nội dung payload vào log.
    if (!payload.success) throw new Error('HOLD_EXPIRY_PAYLOAD_INVALID');
    const reconcile = payload.data.mode === HOLD_EXPIRY_RECONCILE;
    const report = await sweepDueHolds(
      prismaHoldExpiryPort(context.db),
      {
        batchSize: context.config.HOLD_EXPIRY_BATCH_SIZE,
        maxPages: reconcile ? RECONCILE_MAX_PAGES : 1,
        missedGraceSeconds: context.config.HOLD_EXPIRY_INTERVAL_SECONDS * MISSED_GRACE_CYCLES,
      },
      context.log,
    );
    context.log({
      queue: HOLD_QUEUE,
      msg:
        `quét hết hạn (${payload.data.mode}): ${report.scanned} đến hạn, ${report.expired} hết hạn, ` +
        `${report.skipped} bỏ qua (đã đổi trạng thái/khoá bởi giao dịch khác), ${report.failed} lỗi, ` +
        `nhả ${report.releasedAssignments} phân công + ${report.releasedAllotments} hàng allotment, ` +
        `lập ${report.refundRequests} hồ sơ hoàn (${report.refundedAmount} VND), ` +
        `${report.missed} quá hạn SLA, ${report.pages} trang`,
    });
    if (!reconcile) return;
    let session: HoldProjectionSession | undefined;
    try {
      session = (deps.createProjection ?? createHoldProjectionSession)(context.config.REDIS_URL);
      const reconciled = await reconcileHoldProjection(context.db, session.store, {
        maxKeys: context.config.HOLD_RECONCILE_MAX_KEYS,
      });
      context.log({
        queue: HOLD_QUEUE,
        msg:
          `đối chiếu Hold: đọc ${reconciled.scanned} bản ghi, ${reconciled.active} còn ACTIVE, ` +
          `sửa ${reconciled.repaired}, xoá ${reconciled.orphaned} mồ côi, ` +
          `${reconciled.unreadable} không đọc được`,
      });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      context.log({
        queue: HOLD_QUEUE,
        msg: `đối chiếu Hold lỗi (mã ${errorCode}); phần CSDL đã xong, lượt 900 giây sau đối chiếu lại`,
        errorCode,
      });
    } finally {
      await session?.close();
    }
  };
}

export const holdExpiryJob: JobHandler = createHoldExpiryJob();
