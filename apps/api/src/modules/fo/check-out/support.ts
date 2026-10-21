/** Tiện ích thuần của lệnh trả phòng: giờ dân sự VN, khoá nghĩa vụ, lỗi hạ tầng. */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { DomainError } from '@pinehill/domain';
import type { CheckOutRequest } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { LedgerError } from '../../pay/ledger/projection.js';

/** Mã sổ cái nghĩa là hạn mức hoàn vượt tiền thực thu (như `book/cancel/writes.ts`). */
const overPaid = ['LEDGER_SOURCE_CAP', 'LEDGER_BOOKING_CAP', 'LEDGER_REFUND_NET'];

/** `source_key` của dòng phụ thu trả muộn — một dòng/booking, đọc lại để trả phản hồi. */
export const FEE_SOURCE_KEY = 'checkout-late-fee';

/** Một khoản phát sinh đã chuẩn hoá thành nghĩa vụ `EXTRA_SERVICE` (VND nguyên). */
export interface ExtraLine {
  readonly key: string;
  readonly amount: number;
  readonly description: string;
}

/** Lỗi nghiệp vụ phải ra 4xx, không phải 500: sổ tiền/động cơ từ chối là nguyên nhân kinh doanh. */
function ledgerFailure(error: LedgerError): AppError {
  return overPaid.includes(error.reason)
    ? new AppError(422, 'E_PAY_REFUND_EXCEEDS_PAID', 'Tiền hoàn vượt số đã thu.')
    : new AppError(409, 'E_BOOK_INVALID_STATE', 'Sổ tiền không cho phép trả phòng.');
}

function retryablePrisma(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(String(error.meta?.code))))
  );
}

export function safeError(error: unknown): never {
  if (error instanceof AppError || error instanceof RetryTransaction) throw error;
  if (error instanceof LedgerError) throw ledgerFailure(error);
  if (error instanceof DomainError)
    throw new AppError(409, 'E_BOOK_INVALID_STATE', 'Không thể tính tiền cho lần trả phòng này.');
  if (retryablePrisma(error))
    throw new RetryTransaction(
      new AppError(409, 'E_SYS_REQUEST_IN_PROGRESS', 'Booking đang được cập nhật.', 1),
    );
  throw error;
}

/** Phụ thu muộn **đã ghi sổ** theo `source_key`; không bao giờ trả con số engine vừa tính. */
export async function bookedFee(
  tx: Prisma.TransactionClient,
  bookingId: string,
  sourceKey: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ amount: bigint }[]>`
    SELECT amount FROM booking_charges
     WHERE booking_id = ${bookingId}::uuid AND source_key = ${sourceKey}
       AND voided_amount < amount`;
  if (!rows.length) return 0;
  const amount = rows[0]!.amount;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AppError(500, 'E_GEN_SERVICE_UNAVAILABLE', 'Phụ thu vượt giới hạn an toàn.');
  return Number(amount);
}

/**
 * `booking_charges.source_key` bền vững: gộp cùng `(mô tả, đơn giá)` và **cộng dồn số lượng** để
 * hai dòng giống nhau trong một yêu cầu không bị tính thiếu; gửi lại cùng nội dung không ghi thêm.
 */
export function extraLines(extras: CheckOutRequest['extras']): ExtraLine[] {
  const groups = new Map<
    string,
    { readonly description: string; readonly unit: number; quantity: number }
  >();
  for (const extra of extras ?? []) {
    const key = createHash('sha256')
      .update(JSON.stringify([extra.description, extra.amount]))
      .digest('hex')
      .slice(0, 16);
    const current = groups.get(key);
    if (current) current.quantity += extra.quantity ?? 1;
    else
      groups.set(key, {
        description: extra.description,
        unit: extra.amount,
        quantity: extra.quantity ?? 1,
      });
  }
  return [...groups.entries()].map(([key, line]) => ({
    key: `checkout-extra:${key}`,
    amount: line.unit * line.quantity,
    description: line.description,
  }));
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
