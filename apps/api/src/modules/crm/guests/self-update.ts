/**
 * HB-260 — `PATCH /guests/me`: khách tự sửa họ tên, email, đồng ý nhận khuyến mãi (SCR-83, UC-CRM-01).
 * Không sửa SĐT (định danh BR-CRM-01). Đồng ý ghi `consent_at` = giờ máy chủ + phiên bản điều khoản
 * (NFR-COMP-01); rút đồng ý xoá mốc. Audit chỉ ghi **tên** trường đổi, không chép họ tên/email (NFR-SEC-03).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { GuestSelfUpdateRequest, GuestSummary } from '@pinehill/contracts';
import type { ActorContext } from '../../../common/actor/actor-context.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { invalid } from '../../inv/allotments/validation.js';
import { missing } from '../../sys/settings/validation.js';
import { guestAdminSelect, project } from './projection.js';

export interface SelfUpdateDeps {
  readonly db: PrismaClient;
  readonly clock: Clock;
  readonly audit: AuditWriter;
}

function changes(input: GuestSelfUpdateRequest, now: Date): Prisma.guestsUpdateInput {
  const data: Prisma.guestsUpdateInput = { updated_at: now };
  if (input.fullName !== undefined) {
    const name = input.fullName.trim();
    if (name === '') throw invalid();
    data.full_name = name;
  }
  if (input.email !== undefined) data.email = input.email;
  if (input.consentMarketing !== undefined) {
    data.consent_marketing = input.consentMarketing;
    data.consent_at = input.consentMarketing ? now : null;
    data.consent_version = input.consentMarketing ? (input.consentVersion ?? null) : null;
  }
  return data;
}

export async function updateOwnProfile(
  deps: SelfUpdateDeps,
  guestId: string,
  input: GuestSelfUpdateRequest,
  actor: ActorContext,
): Promise<GuestSummary> {
  const now = deps.clock.now();
  const data = changes(input, now);
  return deps.db.$transaction(async (tx) => {
    const current = await tx.guests.findUnique({
      where: { id: guestId },
      select: { anonymized_at: true },
    });
    if (current === null || current.anonymized_at !== null) throw missing();
    const row = await tx.guests.update({ where: { id: guestId }, data, select: guestAdminSelect });
    await deps.audit.record(tx, {
      actor,
      action: 'GUEST_PROFILE_UPDATED',
      entityType: 'Guest',
      entityId: guestId,
      beforeJson: null,
      afterJson: {
        changed: Object.keys(input).filter((key) => key !== 'consentVersion'),
        consentMarketing: row.consent_marketing,
      },
      reason: null,
    });
    return project(row);
  });
}
