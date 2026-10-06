/**
 * Phần thuần cho SCR-49/SCR-50 (CRM quản trị): kiểm lý do ẩn danh hoá/danh sách đen, dựng tham số tra cứu
 * và thân lệnh. Không xử lý PII ở đây — máy chủ che theo vai trò (BR-CRM-05, NFR-SEC-03).
 */
import type { GuestAnonymizeRequest, LoyaltyTier } from '@pinehill/contracts';

export interface FieldIssue {
  field: string;
  issue: string;
}

export interface GuestSearch {
  q: string;
  loyaltyTier: LoyaltyTier | '';
  blacklisted: 'ALL' | 'YES' | 'NO';
}

export const EMPTY_SEARCH: GuestSearch = { q: '', loyaltyTier: '', blacklisted: 'ALL' };

/** Tham số tra cứu: chỉ gửi bộ lọc đã khai, bỏ chuỗi rỗng. */
export function searchParams(filters: GuestSearch): {
  q?: string;
  loyaltyTier?: LoyaltyTier;
  blacklisted?: boolean;
} {
  return {
    ...(filters.q.trim() === '' ? {} : { q: filters.q.trim() }),
    ...(filters.loyaltyTier === '' ? {} : { loyaltyTier: filters.loyaltyTier }),
    ...(filters.blacklisted === 'ALL' ? {} : { blacklisted: filters.blacklisted === 'YES' }),
  };
}

/**
 * Ẩn danh hoá bắt buộc **lý do** và phải **xác nhận** trong hộp thoại (AC1, BR-CRM-05);
 * không có đường xoá cứng hồ sơ (§2.14).
 */
export function anonymizeIssues(reason: string, confirmed: boolean): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (reason.trim() === '') issues.push({ field: 'reason', issue: 'REQUIRED' });
  if (!confirmed) issues.push({ field: 'confirmed', issue: 'NOT_CONFIRMED' });
  return issues;
}

/** Thân lệnh ẩn danh hoá; `requestedAt` là mốc người dùng bấm xác nhận. */
export function anonymizeRequest(reason: string, requestedAt: string): GuestAnonymizeRequest {
  return { reason: reason.trim(), requestedAt };
}

/** Lý do bắt buộc khi thêm **hoặc** gỡ khỏi danh sách đen (BR-CRM-04, cần MANAGER). */
export function blacklistIssues(reason: string): readonly FieldIssue[] {
  return reason.trim() === '' ? [{ field: 'blacklistReason', issue: 'REQUIRED' }] : [];
}

/** Nhãn hạng khách hàng để hiển thị (nhãn lấy từ danh mục câu chữ, không viết cứng trong component). */
export const TIER_LABEL_KEY: Readonly<Record<LoyaltyTier, TierLabelKey>> = {
  GUEST: 'enum.loyaltyTier.GUEST',
  MEMBER: 'enum.loyaltyTier.MEMBER',
  SILVER: 'enum.loyaltyTier.SILVER',
  GOLD: 'enum.loyaltyTier.GOLD',
  PLATINUM: 'enum.loyaltyTier.PLATINUM',
};

export type TierLabelKey =
  | 'enum.loyaltyTier.GUEST'
  | 'enum.loyaltyTier.MEMBER'
  | 'enum.loyaltyTier.SILVER'
  | 'enum.loyaltyTier.GOLD'
  | 'enum.loyaltyTier.PLATINUM';
