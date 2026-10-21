/**
 * Dữ kiện trả phòng sớm (BR-CANCEL-09).
 *
 * Trả phòng sớm = huỷ phần **đêm chưa ở**: nghĩa vụ ROOM của các đêm đó được void và phân bổ
 * của chúng được nhả (đúng bất biến của `voidRoomCharges`/`releaseAssignments` HB-097), nên tiền
 * đã thu cho phần chưa ở trở lại nguồn thu để engine HB-053 lập `RefundRequest` — không tự ghi
 * `paidAmount`/`refundedAmount`. Nghĩa vụ các đêm đã ở vẫn giữ nguyên.
 */
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Void nghĩa vụ ROOM của các đêm `[fromDate, checkOut)` và nhả phân bổ; trả giá trị đã void. */
export async function voidUnusedNights(
  tx: Tx,
  bookingId: string,
  rooms: readonly string[],
  fromDate: string,
  checkOutDate: string,
  now: Date,
): Promise<bigint> {
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
  if (!rows.length) return 0n;
  const ids = rows.map((row) => row.id);
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
  return value;
}

/**
 * BR-CANCEL-09: cơ sở hoàn = `min(paidAmount, giá các đêm chưa ở)`. Engine HB-053 nhận các khoản
 * thu theo `receipts`, nên cắt chúng xuống đúng trần này — không tự áp tỷ lệ hay tự chia tiền.
 */
export function capReceipts(
  receipts: readonly { readonly id: string; readonly amount: bigint }[],
  cap: bigint,
): { id: string; amount: bigint }[] {
  const capped: { id: string; amount: bigint }[] = [];
  let left = cap;
  for (const receipt of receipts) {
    if (left <= 0n) break;
    const amount = receipt.amount < left ? receipt.amount : left;
    capped.push({ id: receipt.id, amount });
    left -= amount;
  }
  return capped;
}
