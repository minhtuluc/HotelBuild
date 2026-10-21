/** Tiện ích thuần của lệnh trả phòng: giờ dân sự VN, khoá nghĩa vụ, lỗi hạ tầng. */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CheckOutRequest } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';

/** Một khoản phát sinh đã chuẩn hoá thành nghĩa vụ `EXTRA_SERVICE` (VND nguyên). */
export interface ExtraLine {
  readonly key: string;
  readonly amount: number;
  readonly description: string;
}

/** Cùng quy ước các lệnh ghi khác: lỗi khoá/CSDL là tín hiệu chạy lại toàn transaction (HB-029). */
export function safeError(error: unknown): never {
  if (error instanceof AppError || error instanceof RetryTransaction) throw error;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(String(error.meta?.code))))
  )
    throw new RetryTransaction(
      new AppError(409, 'E_SYS_REQUEST_IN_PROGRESS', 'Booking đang được cập nhật.', 1),
    );
  throw error;
}

/** `booking_charges.source_key` bền vững: gửi lại cùng khoản không bao giờ ghi tiền hai lần. */
export function extraLines(extras: CheckOutRequest['extras']): ExtraLine[] {
  const lines = new Map<string, ExtraLine>();
  for (const extra of extras ?? []) {
    const quantity = extra.quantity ?? 1;
    const key = `checkout-extra:${createHash('sha256')
      .update(JSON.stringify([extra.description, extra.amount, quantity]))
      .digest('hex')
      .slice(0, 16)}`;
    if (!lines.has(key))
      lines.set(key, { key, amount: extra.amount * quantity, description: extra.description });
  }
  return [...lines.values()];
}

/** Ngày lịch VN của một mốc tuyệt đối (BR-GEN-04); không dùng ngày UTC. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Dữ kiện giờ địa phương mà engine HB-141/142 nhận — biên đó không tự đọc đồng hồ. */
export function localNow(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? '0');
  return {
    date: localDate(instant, timeZone),
    millisecondsSinceMidnight:
      ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 +
      instant.getUTCMilliseconds(),
    // Hợp đồng engine F7 chỉ nhận giờ dân sự Việt Nam (BR-GEN-04); cấu hình cũng bắt buộc VN.
    timeZone: 'Asia/Ho_Chi_Minh' as const,
  };
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
