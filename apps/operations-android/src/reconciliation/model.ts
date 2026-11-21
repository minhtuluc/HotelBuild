/**
 * SCR-68 (HB-263) — đối soát nhanh tiền mặt theo ngày VN trên app vận hành: phần thuần.
 * Lễ tân xem tổng tiền mặt mình thu; **chỉ kế toán chốt** quỹ của người thu (tách nhiệm vụ, HB-262).
 * Mọi con số tiền là nguyên văn máy chủ trả; app không tự cộng sổ.
 */
import type {
  ReconciliationCloseRequest,
  ReconciliationCloseResponse,
  UserMe,
} from '@pinehill/contracts';

const VN_OFFSET_MS = 7 * 3600 * 1000;

/** Ngày nghiệp vụ `YYYY-MM-DD` theo giờ Việt Nam (BR-GEN-02), không theo múi giờ của máy. */
export function businessDateVn(nowMs: number): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Quyền chốt quỹ (`reconciliation.close`) chỉ thuộc ACCOUNTANT; vai trò khác chỉ xem. */
export function canClose(role: UserMe['role']): boolean {
  return role === 'ACCOUNTANT';
}

/** Số tiền đếm (VND nguyên ≥ 0); cho phép dấu chấm/khoảng trắng phân cách nghìn. Sai dạng ⇒ `null`. */
export function parseCountedCash(raw: string): number | null {
  const compact = raw.replace(/[\s.]/g, '');
  if (!/^\d{1,13}$/.test(compact)) return null;
  return Number(compact);
}

export type CloseBody = Omit<ReconciliationCloseRequest, 'pinToken'>;

export function closeBodyFor(
  propertyId: string,
  businessDate: string,
  collectorId: string,
  countedCash: number,
  note: string,
): CloseBody {
  const trimmed = note.trim();
  return {
    propertyId,
    businessDate,
    collectorId,
    countedCash,
    ...(trimmed === '' ? {} : { note: trimmed }),
  };
}

/** Phản hồi đúng là kết quả của lệnh vừa gửi (cơ sở, ngày, số đếm). */
export function closeMatches(body: CloseBody, response: ReconciliationCloseResponse): boolean {
  return (
    response.propertyId === body.propertyId &&
    response.businessDate === body.businessDate &&
    response.countedCash === body.countedCash
  );
}

const VND = new Intl.NumberFormat('vi-VN');

/** Chênh lệch quỹ có dấu (`counted − expected`): thiếu "−", thừa "+"; `formatVnd` chỉ nhận số không âm. */
export function formatDifference(amount: number): string {
  const sign = amount < 0 ? '−' : amount > 0 ? '+' : '';
  return `${sign}${VND.format(Math.abs(amount))} ₫`;
}
