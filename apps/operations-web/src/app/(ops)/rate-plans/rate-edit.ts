import { parseInteger } from '../../../lib/rate-policy-tiers';
import type { RatePlanAdmin } from '@pinehill/contracts';
import { ratePlanDraftOf, type RatePlanDraft } from '../../../lib/rate-plans';
export function rebasePlan(
  local: RatePlanDraft,
  before: RatePlanAdmin,
  current: RatePlanAdmin,
): RatePlanDraft {
  const original = ratePlanDraftOf(before),
    next = ratePlanDraftOf(current);
  for (const key of ['depositPercent', 'minNights', 'maxNights'] as const)
    if (parseInteger(local[key]) !== before[key]) next[key] = local[key];
  if (local.cancellationPolicyId.trim() !== before.cancellationPolicyId)
    next.cancellationPolicyId = local.cancellationPolicyId;
  if (local.status !== original.status) next.status = local.status;
  next.reason = local.reason;
  return next;
}
