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
