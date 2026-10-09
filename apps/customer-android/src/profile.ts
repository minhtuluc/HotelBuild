/**
 * SCR-83 (HB-115) — hồ sơ khách trên Android: **phần chỉ-đọc**.
 *
 * Hai tuyến self của hợp đồng (`GET /guests/me`, `GET /guests/me/loyalty`) trả hồ sơ và điểm của **chính
 * khách theo phiên** — client không gửi `guestId` nào. Quyết định của chủ dự án ở HB-105 (web) áp dụng
 * nguyên cho Android: phần **cập nhật** hồ sơ bị cắt cho tới khi có tuyến ghi (`PATCH /guests/me`), màn
 * hình ghi rõ phần chờ thay vì dựng nút giả.
 */
import { guestLoyaltySchema, guestSummarySchema } from '@pinehill/contracts';
import type { ApiClient } from '@pinehill/api-client';
import { isApiError } from '@pinehill/api-client';
import type { GuestLoyalty, GuestSummary, LoyaltyTier } from '@pinehill/contracts';
import { OfflineError, requireOnline, type NetInfoSource } from './netinfo';
import type { MessageKey } from './strings';

export interface ProfileRow {
  readonly key: 'name' | 'phone' | 'email' | 'created' | 'consent';
  readonly value: string;
}

/** Dòng hồ sơ hiển thị; giá trị rỗng thay bằng gạch ngang, hạng để màn hình dịch nhãn. */
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

/** Ba con số tích luỹ máy chủ trả; app chỉ đọc, không tính lại. */
export function loyaltyRows(loyalty: GuestLoyalty): readonly LoyaltyRow[] {
  return [
    { key: 'points', value: loyalty.loyaltyPoints },
    { key: 'stays12', value: loyalty.staysLast12Months },
    { key: 'staysTotal', value: loyalty.totalStays },
  ];
}

/** Hạng/điểm ở hai tuyến lệch nhau thì màn hình cảnh báo để cơ sở kiểm, không tự chọn một phía. */
export function tierMismatch(guest: GuestSummary, loyalty: GuestLoyalty): boolean {
  return guest.loyaltyTier !== loyalty.loyaltyTier || guest.loyaltyPoints !== loyalty.loyaltyPoints;
}

export const TIER_LABEL_KEYS: Readonly<Record<LoyaltyTier, MessageKey>> = {
  GUEST: 'profile.tier.GUEST',
  MEMBER: 'profile.tier.MEMBER',
  SILVER: 'profile.tier.SILVER',
  GOLD: 'profile.tier.GOLD',
  PLATINUM: 'profile.tier.PLATINUM',
};

/** Bề mặt API cần cho màn này — tách ra để test không cần mạng. */
export interface ProfileApi {
  me(): Promise<GuestSummary>;
  loyalty(): Promise<GuestLoyalty>;
}

export type ProfileOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'ready'; readonly profile: GuestSummary; readonly loyalty: GuestLoyalty }
  | { readonly kind: 'failed'; readonly code: string | null };

/** Đọc hồ sơ + điểm: offline thì **không** gọi mạng; lỗi khác trả mã để màn hình hiện câu chữ theo mã. */
export async function loadProfile(deps: {
  readonly api: ProfileApi;
  readonly net: NetInfoSource;
}): Promise<ProfileOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    const [profile, loyalty] = await Promise.all([deps.api.me(), deps.api.loyalty()]);
    return { kind: 'ready', profile, loyalty };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
}

/** Dựng bề mặt API từ client đã có access token của phiên khách. */
export function profileApiFrom(client: ApiClient): ProfileApi {
  return {
    me: async () => {
      const response = await client.request({
        method: 'GET',
        path: '/guests/me',
        decoder: guestSummarySchema,
      });
      return response.data;
    },
    loyalty: async () => {
      const response = await client.request({
        method: 'GET',
        path: '/guests/me/loyalty',
        decoder: guestLoyaltySchema,
      });
      return response.data;
    },
  };
}
