/**
 * Chia **tổng tiền kênh đã bán** thành các dòng `booking_charges` theo (đơn vị bán × đêm).
 *
 * Nguồn đơn giá là `priced.nights[].nightlyPrice` của engine giá (giá **một** đơn vị cho một đêm);
 * tổng của engine đã làm tròn xuống 1.000 VND (BR-RATE-01 bước 11) nên hiệu số luôn ≤ 0 và được trừ
 * vào ô đầu tiên. Bất biến: `Σ cells = total` — nếu không đặt được phần lệch thì ném lỗi lập trình
 * thay vì ghi sổ lệch tiền (BR-GEN-01, BR-PAY-02).
 */

export type AmountCells = readonly (readonly bigint[])[];

export function chargeCells(
  total: bigint,
  nightlyPrices: readonly number[],
  roomCount: number,
): AmountCells {
  if (nightlyPrices.length === 0) throw new Error('OTA event without nights');
  const cells = Array.from({ length: roomCount }, () =>
    nightlyPrices.map((price) => BigInt(price)),
  );
  let residual = total - cells.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0n), 0n);
  if (residual !== 0n) {
    for (const row of cells) {
      for (let index = 0; index < row.length && residual !== 0n; index += 1) {
        const amount = row[index] ?? 0n;
        const delta = residual < 0n ? (amount > -residual ? residual : -amount) : residual;
        row[index] = amount + delta;
        residual -= delta;
      }
    }
  }
  if (residual !== 0n) throw new Error('OTA charge split leaves money unplaced');
  return cells;
}
