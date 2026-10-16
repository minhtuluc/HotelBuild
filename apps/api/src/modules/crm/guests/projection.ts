import type { Prisma } from '@prisma/client';
import { loyaltyTierSchema, type GuestSummary } from '@pinehill/contracts';

/** Chỉ trường an toàn của hồ sơ khách (NFR-COMP-01): không lộ `idNumber`, `dob`, `nationality`. */
export const guestSelect = {
  id: true,
  full_name: true,
  phone: true,
  email: true,
  loyalty_tier: true,
  loyalty_points: true,
  total_stays: true,
  blacklisted: true,
  consent_marketing: true,
  created_at: true,
} as const satisfies Prisma.guestsSelect;

/**
 * Cột quản trị chỉ dùng nội bộ (không rời máy chủ): mốc ẩn danh hoá, lý do danh sách đen và `updated_at`
 * cho tuyến loyalty. `guestSelect` đã là tập trường tối thiểu trả cho máy khách (NFR-COMP-01).
 */
export const guestAdminSelect = {
  ...guestSelect,
  anonymized_at: true,
  blacklist_reason: true,
  updated_at: true,
} as const satisfies Prisma.guestsSelect;

export function project(
  row: Prisma.guestsGetPayload<{ select: typeof guestSelect }>,
): GuestSummary {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    loyaltyTier: loyaltyTierSchema.parse(row.loyalty_tier),
    loyaltyPoints: row.loyalty_points,
    totalStays: row.total_stays,
    blacklisted: row.blacklisted,
    consentMarketing: row.consent_marketing,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Snapshot hồ sơ khách để ghi `audit_logs`. `project` chỉ mang trường PII tối thiểu, nhưng `AuditWriter`
 * che `phone`/`email` mà **không** che `fullName` → họ tên phải bị thay tại đây (NFR-SEC-03, TC-CRM-04:
 * nhật ký không chứa họ tên đầy đủ). `idNumber`/`dob`/`nationality`/`notes` không nằm trong projection
 * nên không bao giờ vào nhật ký. `extra` chỉ nhận văn bản không PII (mốc thời điểm, mốc yêu cầu).
 */
export function auditGuest(
  summary: GuestSummary,
  extra: Readonly<Record<string, string | null>> = {},
): Prisma.InputJsonObject {
  return { ...summary, fullName: '****', ...extra };
}
