/**
 * Dữ kiện trả phòng sớm (BR-CANCEL-09).
 *
 * Trả phòng sớm = huỷ phần **đêm chưa ở**: nghĩa vụ ROOM của các đêm đó được void và phân bổ
 * của chúng được nhả (đúng bất biến `voidRoomCharges`/`releaseAssignments` HB-097), nên tiền
 * đã thu cho phần chưa ở trở lại nguồn thu để lập `RefundRequest` — không tự ghi
 * `paidAmount`/`refundedAmount`. Nghĩa vụ các đêm đã ở vẫn giữ nguyên.
 *
 * Hoàn tính theo **cấu hình trả phòng sớm** đã chốt trong snapshot
 * (`earlyCheckoutFreeHours`/`earlyCheckoutRefundPct`), không dùng bậc chính sách huỷ:
 * cơ sở = `min(paidAmount, Σ giá đêm chưa ở)`, làm tròn xuống 1.000 VND; tỷ lệ = 0 khi gói
 * không hoàn (`freeHours = null`) hoặc chưa đủ ngưỡng báo trước.
 *
 * Hợp đồng F7 không có mốc "thời điểm nhận thông báo"; thời gian còn lại tới giờ trả phòng danh
 * nghĩa của snapshot là đại lượng báo trước quan sát được duy nhất (khách báo ngay khi trả sớm
 * còn ≥ `freeHours` của kỳ đã đặt).
 */
import type { Prisma } from '@prisma/client';
import { AppError } from '../../../common/app-error.js';
import { nominalCheckInMs } from '../../book/cancel/context.js';
import type { CancelFacts } from '../../book/cancel/context.js';

type Tx = Prisma.TransactionClient;

const HOUR = 3_600_000;

/** Nghĩa vụ đã void và tiền thực sự được nhả theo từng nguồn thu. */
export interface Voids {
  /** Σ giá đêm chưa ở (nghĩa vụ ROOM trước khi void). */
  readonly value: bigint;
  /** paymentId → số tiền phân bổ được nhả (`released_amount`), tức trần hoàn thực tế. */
  readonly released: ReadonlyMap<string, bigint>;
}

export interface EarlyRefundPlan {
  readonly base: bigint;
  readonly refundPercent: number;
  readonly noticeHours: number;
  readonly amount: bigint;
  readonly legs: readonly { readonly paymentId: string; readonly amount: bigint }[];
}

/** Void nghĩa vụ ROOM của các đêm `[fromDate, checkOut)` và nhả phân bổ của chính chúng. */
export async function voidUnusedNights(
  tx: Tx,
  bookingId: string,
  rooms: readonly string[],
  fromDate: string,
  checkOutDate: string,
  now: Date,
): Promise<Voids> {
  const rows = await tx.$queryRaw<{ id: string; amount: bigint }[]>`
    SELECT id, amount - voided_amount AS amount
      FROM booking_charges
     WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM'
       AND booking_room_id = ANY(${[...rooms]}::uuid[])
       AND stay_date >= ${fromDate}::date AND stay_date < ${checkOutDate}::date
       AND voided_amount < amount
     ORDER BY id FOR UPDATE`;
  let value = 0n;
  for (const row of rows) value += row.amount;
  if (!rows.length) return { value: 0n, released: new Map() };
  const ids = rows.map((row) => row.id);
  const releasedRows = await tx.$queryRaw<{ payment_id: string; amount: bigint }[]>`
    SELECT payment_id, sum(amount - released_amount)::bigint AS amount
      FROM payment_allocations
     WHERE charge_id = ANY(${ids}::uuid[]) AND released_amount < amount
     GROUP BY payment_id`;
  await tx.$executeRaw`
    UPDATE payment_allocations
       SET released_amount = amount, release_reason = 'EARLY_CHECKOUT',
           updated_at = ${now}::timestamptz
     WHERE released_amount < amount AND charge_id = ANY(${ids}::uuid[])`;
  await tx.$executeRaw`
    UPDATE booking_charges
       SET voided_amount = amount, reason = 'EARLY_CHECKOUT', updated_at = ${now}::timestamptz
     WHERE id = ANY(${ids}::uuid[])`;
  // Cùng bất biến `closeBooking` (HB-097): `total_amount` = tổng nghĩa vụ ROOM còn hiệu lực.
  await tx.$executeRaw`
    UPDATE bookings
       SET total_amount = (SELECT coalesce(sum(amount - voided_amount), 0)
                             FROM booking_charges
                            WHERE booking_id = ${bookingId}::uuid AND kind = 'ROOM'),
           updated_at = ${now}::timestamptz
     WHERE id = ${bookingId}::uuid`;
  return {
    value,
    released: new Map(releasedRows.map((row) => [row.payment_id, row.amount])),
  };
}

/**
 * BR-CANCEL-09: cơ sở `min(paidAmount, đêm chưa ở)`, tỷ lệ lấy từ snapshot; không bao giờ lập
 * hoàn lớn hơn tiền thực sự được nhả (tránh `LEDGER_SOURCE_CAP` và bịa tiền).
 */
export function planEarlyRefund(facts: CancelFacts, voids: Voids, nowMs: number): EarlyRefundPlan {
  const { earlyCheckoutFreeHours, earlyCheckoutRefundPct } = facts.policy;
  if (earlyCheckoutFreeHours === undefined || earlyCheckoutRefundPct === undefined)
    throw new AppError(
      422,
      'E_RATE_CONFIGURATION_INVALID',
      'Snapshot giá thiếu cấu hình trả phòng sớm; không thể tính tiền hoàn.',
    );
  const checkOutMs = nominalCheckInMs(
    facts.payload.stay.checkOut,
    facts.payload.stay.checkOutTime,
    facts.payload.stay.timezone,
  );
  const noticeHours = Math.max(0, (checkOutMs - nowMs) / HOUR);
  const applied =
    earlyCheckoutFreeHours !== null &&
    earlyCheckoutRefundPct > 0 &&
    noticeHours >= earlyCheckoutFreeHours;
  const refundPercent = applied ? earlyCheckoutRefundPct : 0;
  const base = facts.paidAmount < voids.value ? facts.paidAmount : voids.value;
  // BR-CANCEL-04/11: làm tròn **xuống** 1.000 VND, số nguyên bigint, không dấu phẩy động.
  const computed = ((base * BigInt(refundPercent)) / 100n / 1000n) * 1000n;
  let available = 0n;
  for (const amount of voids.released.values()) available += amount;
  const amount = computed < available ? computed : available;
  return { base, refundPercent, noticeHours, amount, legs: refundLegs(amount, voids.released) };
}

/** Chia số hoàn theo tiền đã nhả của từng nguồn; thứ tự UUID ổn định, không vượt trần nguồn. */
function refundLegs(amount: bigint, released: ReadonlyMap<string, bigint>) {
  const legs: { paymentId: string; amount: bigint }[] = [];
  let left = amount;
  const ordered = [...released.entries()].sort(([leftId], [rightId]) =>
    leftId < rightId ? -1 : 1,
  );
  for (const [paymentId, available] of ordered) {
    if (left <= 0n) break;
    const take = available < left ? available : left;
    if (take > 0n) legs.push({ paymentId, amount: take });
    left -= take;
  }
  return legs;
}
