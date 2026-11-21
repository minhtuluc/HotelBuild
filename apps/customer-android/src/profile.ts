/**
 * SCR-83 (HB-115, HB-260) — hồ sơ khách trên Android.
 *
 * Tuyến self (`GET/PATCH /guests/me`, `GET /guests/me/loyalty`) đọc và sửa hồ sơ của **chính khách theo
 * phiên** — client không gửi `guestId` nào. Khách tự sửa họ tên, email, đồng ý nhận khuyến mãi; SĐT là
 * định danh (BR-CRM-01) nên không sửa ở app.
 */
import {
  guestLoyaltySchema,
  guestSelfUpdateRequestSchema,
  guestSummarySchema,
} from '@pinehill/contracts';
import type { ApiClient } from '@pinehill/api-client';
import { isApiError } from '@pinehill/api-client';
import type {
  GuestLoyalty,
  GuestSelfUpdateRequest,
  GuestSummary,
  LoyaltyTier,
} from '@pinehill/contracts';
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
  /** HB-260 — `PATCH /guests/me`. */
  update(request: GuestSelfUpdateRequest): Promise<GuestSummary>;
}

/** Phiên bản điều khoản nhận khuyến mãi — cùng giá trị màn đăng ký gửi (`app/login.tsx`). */
export const CONSENT_VERSION = '2026-10';

/** Bản nháp của form sửa hồ sơ (SĐT là định danh, không sửa — BR-CRM-01). */
export interface ProfileDraft {
  readonly fullName: string;
  readonly email: string;
  readonly consent: boolean;
}

export function draftOf(guest: GuestSummary): ProfileDraft {
  return { fullName: guest.fullName, email: guest.email ?? '', consent: guest.consentMarketing };
}

export type DraftIssue = 'name' | 'email' | 'unchanged';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function consentPatch(
  next: boolean,
  current: boolean,
): Pick<GuestSelfUpdateRequest, 'consentMarketing' | 'consentVersion'> {
  if (next === current) return {};
  return next
    ? { consentMarketing: true, consentVersion: CONSENT_VERSION }
    : { consentMarketing: false };
}

/** Chỉ gửi trường đã đổi; kiểm tại chỗ để lỗi hiển nhiên không cần đi máy chủ. */
export function updateRequestFor(
  draft: ProfileDraft,
  guest: GuestSummary,
): { ok: true; request: GuestSelfUpdateRequest } | { ok: false; issue: DraftIssue } {
  const fullName = draft.fullName.trim();
  if (fullName === '') return { ok: false, issue: 'name' };
  const email = draft.email.trim();
  if (email !== '' && !EMAIL.test(email)) return { ok: false, issue: 'email' };
  const nextEmail = email === '' ? null : email;
  const request: GuestSelfUpdateRequest = {
    ...(fullName === guest.fullName ? {} : { fullName }),
    ...(nextEmail === guest.email ? {} : { email: nextEmail }),
    ...consentPatch(draft.consent, guest.consentMarketing),
  };
  if (Object.keys(request).length === 0) return { ok: false, issue: 'unchanged' };
  // Cùng luật với máy chủ (zod `email()`): email lọt regex sơ bộ nhưng máy chủ từ chối thì báo tại chỗ.
  return guestSelfUpdateRequestSchema.safeParse(request).success
    ? { ok: true, request }
    : { ok: false, issue: 'email' };
}

export type SaveOutcome =
  | { readonly kind: 'offline' }
  | { readonly kind: 'saved'; readonly profile: GuestSummary }
  | { readonly kind: 'failed'; readonly code: string | null };

/** Lưu hồ sơ: offline thì không gọi mạng; hồ sơ trả về là bản máy chủ, không tự ghép. */
export async function saveProfile(
  deps: { readonly api: ProfileApi; readonly net: NetInfoSource },
  request: GuestSelfUpdateRequest,
): Promise<SaveOutcome> {
  try {
    await requireOnline(deps.net);
  } catch (caught) {
    if (caught instanceof OfflineError) return { kind: 'offline' };
    throw caught;
  }
  try {
    return { kind: 'saved', profile: await deps.api.update(request) };
  } catch (caught) {
    return { kind: 'failed', code: isApiError(caught) ? (caught.code ?? null) : null };
  }
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
    update: async (request) => {
      const response = await client.request({
        method: 'PATCH',
        path: '/guests/me',
        body: guestSelfUpdateRequestSchema.parse(request),
        decoder: guestSummarySchema,
      });
      return response.data;
    },
  };
}
