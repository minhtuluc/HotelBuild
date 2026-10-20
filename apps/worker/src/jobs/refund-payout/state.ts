/**
 * Chuyển trạng thái kỹ thuật của operation chi (HB-100). Mọi lệnh đều khoá theo
 * `lease_token + version`: worker đã mất lease không ghi được gì, kể cả trạng thái lỗi.
 */
import type { PrismaClient } from '@prisma/client';
import type { ClaimedPayout } from './types.js';

export interface AttemptFence {
  readonly attempts: number;
  readonly version: bigint;
}

/** Bắt đầu một lần gửi PSP: tăng `attempts` **trước** khi gọi mạng để retry luôn đối soát trước. */
export async function startAttempt(
  db: PrismaClient,
  op: ClaimedPayout,
): Promise<AttemptFence | null> {
  const rows = await db.$queryRaw<AttemptFence[]>`
    UPDATE refund_payout_operations
       SET attempts = attempts + 1, last_error = NULL, updated_at = clock_timestamp()
     WHERE id = ${op.id}::uuid AND lease_token = ${op.leaseToken}::uuid AND version = ${op.version}
    RETURNING attempts, version`;
  return rows[0] ?? null;
}

/** Kết quả không rõ/timeout hoặc provider không tự chi được: giữ hạn mức, hẹn đối soát lại. */
export async function parkPayout(
  db: PrismaClient,
  op: ClaimedPayout,
  code: string,
  retrySeconds: number,
): Promise<void> {
  await db.$executeRaw`
    UPDATE refund_payout_operations
       SET status = 'UNKNOWN', last_error = ${code}, lease_token = NULL,
           lease_expires_at = clock_timestamp() + make_interval(secs => ${retrySeconds}::int),
           updated_at = clock_timestamp()
     WHERE id = ${op.id}::uuid AND lease_token = ${op.leaseToken}::uuid AND version = ${op.version}`;
}

/**
 * PSP xác nhận **thất bại dứt điểm**: proof cũ không thể thành công nên được phép thử lại trên cùng
 * nghĩa vụ với **khoá mới**; hết số lần thì `FAILED_FINAL` (hạn mức hoàn vẫn giữ, hồ sơ vẫn APPROVED).
 */
export async function failPayout(
  db: PrismaClient,
  op: ClaimedPayout,
  code: string,
  maxAttempts: number,
): Promise<void> {
  if (op.attempts < maxAttempts) {
    const nextKey = `refund-payout:${op.id}:r${op.attempts}`;
    await db.$executeRaw`
      UPDATE refund_payout_operations
         SET status = 'READY', psp_key = ${nextKey}, last_error = ${code}, lease_token = NULL,
             lease_expires_at = NULL, updated_at = clock_timestamp()
       WHERE id = ${op.id}::uuid AND lease_token = ${op.leaseToken}::uuid AND version = ${op.version}`;
    return;
  }
  await db.$executeRaw`
    UPDATE refund_payout_operations
       SET status = 'FAILED_FINAL', last_error = ${code}, lease_token = NULL,
           lease_expires_at = NULL, finished_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = ${op.id}::uuid AND lease_token = ${op.leaseToken}::uuid AND version = ${op.version}`;
}
