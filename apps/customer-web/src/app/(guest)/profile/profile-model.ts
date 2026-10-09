/**
 * Lớp thuần cho SCR-13 (hồ sơ khách & điểm) — **phần chỉ-đọc**.
 *
 * Quyết định của chủ dự án (HB-105): thêm hai tuyến self chỉ-đọc `GET /guests/me` và
 * `GET /guests/me/loyalty`; **cắt** phần cập nhật hồ sơ và yêu cầu ẩn danh hoá cho tới khi có tuyến ghi
 * tương ứng (xem PR). Mọi con số điểm/hạng đều là nguyên văn máy chủ trả (UC-CRM-02).
 */
import type { GuestLoyalty, GuestSummary, LoyaltyTier } from '@pinehill/contracts';
import type { CustomerMessageKey } from '../../../lib/i18n';

export const TIER_KEYS: Readonly<Record<LoyaltyTier, CustomerMessageKey>> = {
  GUEST: 'guest.profile.tier.GUEST',
  MEMBER: 'guest.profile.tier.MEMBER',
  SILVER: 'guest.profile.tier.SILVER',
  GOLD: 'guest.profile.tier.GOLD',
  PLATINUM: 'guest.profile.tier.PLATINUM',
};

export interface ProfileRow {
  readonly key: 'name' | 'phone' | 'email' | 'created' | 'consent';
  readonly value: string;
}

/** Dòng hồ sơ hiển thị: giá trị rỗng được thay bằng gạch ngang, không tự bịa. */
export function profileRows(guest: GuestSummary, dash: string): readonly ProfileRow[] {
  return [
    { key: 'name', value: guest.fullName },
    { key: 'phone', value: guest.phone },
    { key: 'email', value: guest.email === null ? dash : guest.email },
    { key: 'created', value: guest.createdAt },
    { key: 'consent', value: guest.consentMarketing ? 'yes' : 'no' },
  ];
}

export interface LoyaltyRow {
  readonly key: 'points' | 'stays12' | 'staysTotal';
  readonly value: number;
}

/** Ba con số tích luỹ máy chủ trả; màn hình chỉ đọc, không tính lại. */
export function loyaltyRows(loyalty: GuestLoyalty): readonly LoyaltyRow[] {
  return [
    { key: 'points', value: loyalty.loyaltyPoints },
    { key: 'stays12', value: loyalty.staysLast12Months },
    { key: 'staysTotal', value: loyalty.totalStays },
  ];
}

/** Điểm tích luỹ và hạng trên hai nguồn khác nhau: lệch thì màn hình báo để cơ sở kiểm. */
export function tierMismatch(guest: GuestSummary, loyalty: GuestLoyalty): boolean {
  return guest.loyaltyTier !== loyalty.loyaltyTier || guest.loyaltyPoints !== loyalty.loyaltyPoints;
}
