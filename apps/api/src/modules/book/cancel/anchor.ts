/**
 * Neo xem trước (AC1, HB-097): `If-Match` của `cancel` **phải** là `ETag` do `cancel-preview` trả.
 * Neo ràng buộc toàn bộ kết quả xem trước — policy, bậc, tỷ lệ hoàn, các khoản tiền, phí và **tập phòng**
 * đã chọn — nên đổi bất kỳ thành phần nào giữa hai bước đều bị từ chối `412` (phải xem trước lại).
 */
import { createHash } from 'node:crypto';

/** Khối `cancellation` của hợp đồng (§3.3); `hoursBeforeCheckIn` không vào neo vì trôi theo đồng hồ. */
export interface PreviewBreakdown {
  readonly policyId: string;
  readonly appliedTierId: string;
  readonly hoursBeforeCheckIn: number;
  readonly refundPercent: number;
  readonly paidAmount: number;
  readonly requestedAmount: number;
  readonly penaltyAmount: number;
  readonly refundFee: number;
}

/**
 * `hoursBeforeCheckIn` là số thực trôi liên tục nên không thể vào neo (hai lần gọi luôn lệch nhau vài giây).
 * Mốc giờ vẫn được ràng buộc gián tiếp: qua bậc là `appliedTierId`/`refundPercent`/`requestedAmount` đổi,
 * và những trường đó đều nằm trong neo.
 */
export function previewFingerprint(
  breakdown: PreviewBreakdown,
  rooms: readonly string[],
  forceMajeure: boolean,
): string {
  const canonical = JSON.stringify({
    policyId: breakdown.policyId,
    appliedTierId: breakdown.appliedTierId,
    refundPercent: breakdown.refundPercent,
    paidAmount: breakdown.paidAmount,
    requestedAmount: breakdown.requestedAmount,
    penaltyAmount: breakdown.penaltyAmount,
    refundFee: breakdown.refundFee,
    forceMajeure,
    rooms: [...rooms].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function previewTag(
  version: bigint,
  breakdown: PreviewBreakdown,
  rooms: readonly string[],
  forceMajeure: boolean,
): string {
  return `"${version}.${previewFingerprint(breakdown, rooms, forceMajeure)}"`;
}
